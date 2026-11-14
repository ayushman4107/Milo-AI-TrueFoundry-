import { digest, type Snapshot } from './change-batch.js';
import { LIMITS, validatePath, validateText } from './validation.js';

export class Overlay {
  #files = new Map<string, { base: string; shadow: string }>();
  #frozen = false;
  load(file: Snapshot): void {
    if (this.#frozen) throw new Error('Overlay frozen'); validatePath(file.path); validateText(file.text);
    if (file.text.length > LIMITS.file || this.#files.size >= 512 || [...this.#files.values()].reduce((n,v) => n + v.base.length + v.shadow.length, 0) + file.text.length * 2 > LIMITS.batch) throw new Error('Overlay limit');
    if (this.#files.has(file.path)) throw new Error('File already loaded');
    if ([...this.#files.keys()].some(p => p.toLowerCase() === file.path.toLowerCase())) throw new Error('Path alias');
    this.#files.set(file.path, { base: file.text, shadow: file.text });
  }
  read(path: string) { const f = this.#files.get(path); if (!f) throw new Error('Read file first'); return { text: f.shadow, revision: digest(f.shadow) }; }
  replace(path: string, revision: string, text: string): void {
    if (this.#frozen) throw new Error('Overlay frozen'); validateText(text);
    const f = this.#files.get(path); if (!f || digest(f.shadow) !== revision) throw new Error('Stale overlay revision');
    if (text.length > LIMITS.file || [...this.#files.values()].reduce((n,v) => n + v.base.length + v.shadow.length, 0) - f.shadow.length + text.length > LIMITS.batch) throw new Error('Overlay size limit');
    f.shadow = text;
  }
  freeze(): readonly Snapshot[] { this.#frozen = true; return [...this.#files].map(([path,f]) => Object.freeze({ path, text: f.shadow })); }
  cancel(): void { this.#files.clear(); this.#frozen = true; }
}

export type Inventory = Readonly<{ complete: boolean; disk: ReadonlyMap<string,string>; buffers: ReadonlyMap<string,string> }>;
export function compareInventory(before: Inventory, after: Inventory) {
  const changed = new Set<string>();
  for (const key of ['disk','buffers'] as const) {
    for (const path of new Set([...before[key].keys(), ...after[key].keys()])) if (before[key].get(path) !== after[key].get(path)) changed.add(path);
  }
  return { status: changed.size ? 'changed' : before.complete && after.complete ? 'unchanged' : 'unknown', paths: [...changed].sort() };
}
