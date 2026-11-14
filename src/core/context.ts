import { randomUUID } from 'node:crypto';
import { digest, type Snapshot } from './change-batch.js';
import { LIMITS, validatePath, validateText } from './validation.js';

export type Role = 'definition' | 'registration' | 'test' | 'documentation' | 'changelog' | 'reference';
export type Discovery = Readonly<{ id: string; path: string; revision: string; line: number; role: Role; query: string; excerpt: string }>;
export type Candidate = Readonly<{ id: string; path: string; reason: string; priority: number; levels: readonly [string, string, string, string] }>;

/** Heuristic matches are candidates; the agent still decides what to read and edit. */
export function traceExemplar(files: readonly Snapshot[], symbol: string): readonly Omit<Discovery, 'id'>[] {
  if (!/^[A-Za-z_]\w{0,127}$/.test(symbol)) throw new Error('Use a single identifier, for example routes_command');
  if (files.length > 10000) throw new Error('Trace file limit exceeded');
  const aliases = new Set([symbol]);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const definition = new RegExp(`(?:def|function|class)\\s+${escaped}\\b`);
  let size = 0;
  for (const file of files) {
    validatePath(file.path); validateText(file.text);
    size += file.text.length;
    if (file.text.length > LIMITS.file || size > LIMITS.batch) throw new Error('Trace size limit exceeded');
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (definition.test(lines[i] ?? '')) {
      for (let j=i-1;j>=Math.max(0,i-80);j--) {
        const line=lines[j] ?? '';if(!line.trim())break;
        const match = /@(?:\w+\.)*(?:command|group|register)\(\s*["']([A-Za-z_][\w-]{0,127})["']/.exec(line);
        if (match?.[1] && aliases.size < 32) aliases.add(match[1]);
      }
    }
  }
  const words = [...aliases].map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const search = new RegExp(`(?<![\\w])(?:${words.join('|')})(?![\\w])`);
  const hits: Omit<Discovery, 'id'>[] = [];
  const counts=new Map<string,number>();
  for (const file of files) {
    const lines = file.text.split(/\r?\n/); const revision = digest(file.text);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''; if (!search.test(line)) continue;
      const role: Role = /(?:^|\/)(?:tests?|test_[^/]*)\b/i.test(file.path) ? 'test'
        : /changes|changelog/i.test(file.path) ? 'changelog'
        : /(?:^|\/)(?:docs?|readme)(?:\/|\.|$)/i.test(file.path) ? 'documentation'
        : definition.test(line) ? 'definition'
        : /add_command|register|\.use\(/.test(line) ? 'registration' : 'reference';
      const key=`${role}:${file.path}`;
      if((counts.get(key)??0)>=8 || (counts.get(role)??0)>=24)continue;
      counts.set(key,(counts.get(key)??0)+1);counts.set(role,(counts.get(role)??0)+1);
      hits.push({ path: file.path, revision, line: i + 1, role, query: symbol, excerpt: lines.slice(Math.max(0, i - 1), i + 2).join('\n').slice(0, 1200) });
    }
  }
  const rank:Role[]=['definition','registration','test','documentation','changelog','reference'];
  return hits.sort((a,b)=>rank.indexOf(a.role)-rank.indexOf(b.role)).slice(0,128);
}

export class ProvenanceLedger {
  #discoveries = new Map<string, Discovery>();
  #reads: { discovery: Discovery; startLine: number; endLine: number }[] = [];
  register(hit: Omit<Discovery, 'id'>): Discovery {
    if (this.#discoveries.size >= 1024) throw new Error('Provenance limit exceeded');
    const value = Object.freeze({ ...hit, id: randomUUID() }); this.#discoveries.set(value.id, value); return value;
  }
  read(id: string, file: Snapshot, startLine: number, endLine: number): string {
    const hit = this.#discoveries.get(id);
    if (!hit || hit.path !== file.path || hit.revision !== digest(file.text)) throw new Error('Unknown or stale discovery; search again');
    const lines = file.text.split(/\r?\n/);
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length || endLine - startLine >= 200) throw new Error('Read 1–200 existing lines');
    const exactLines = file.text.match(/[^\n]*\n|[^\n]+$/g) ?? [''];
    const text = exactLines.slice(startLine - 1, endLine).join('');
    if (Buffer.byteLength(text) > 8000 || this.#reads.length >= 1024) throw new Error('Read budget exceeded; narrow the range');
    this.#reads.push({ discovery: hit, startLine, endLine }); return text;
  }
  reads() { return structuredClone(this.#reads); }
}

/** Hard limit covers serialized context bytes; it is not an exact model-token count. */
export function packContext(candidates: readonly Candidate[], budgetBytes: number) {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 2 || budgetBytes > 128000 || candidates.length > 1024) throw new Error('Invalid context budget');
  const included: { id: string; path: string; reason: string; fidelity: number; content: string }[] = [];
  const pruned: { id: string; reason: string }[] = []; const seen = new Set<string>();
  for (const c of [...candidates].sort((a,b) => b.priority - a.priority || a.path.localeCompare(b.path))) {
    validatePath(c.path);
    validateText(c.id); validateText(c.reason);
    if (!c.id || c.id.length > 128 || c.reason.length > 1024 || c.levels.length !== 4 || c.levels.some(v => typeof v !== 'string' || v.length > LIMITS.file)) throw new Error('Context candidate size limit');
    if (!Number.isFinite(c.priority) || seen.has(c.id)) throw new Error('Invalid or duplicate context candidate'); seen.add(c.id);
    let chosen;
    for (let fidelity = 3; fidelity >= 0; fidelity--) {
      const content = c.levels[fidelity]; if (content === undefined) continue;
      validateText(content);
      const entry = { id: c.id, path: c.path, reason: c.reason, fidelity, content };
      if (Buffer.byteLength(JSON.stringify([...included, entry])) <= budgetBytes) { chosen = entry; break; }
    }
    if (chosen) included.push(chosen); else pruned.push({ id: c.id, reason: 'over budget' });
  }
  const text = JSON.stringify(included);
  return { text, bytes: Buffer.byteLength(text), included, pruned };
}
