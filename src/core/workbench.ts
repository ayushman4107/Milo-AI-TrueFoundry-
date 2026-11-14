import { ChangeBatch, digest, type Snapshot, type Span, type CommitPlan } from './change-batch.js';
import { traceExemplar, ProvenanceLedger, packContext, type Candidate } from './context.js';
import { Overlay } from './overlay.js';
import { replacementHunks } from './hunks.js';

/** One model attempt owns one workbench. No disk/editor write capability is exposed here. */
export class Workbench {
  readonly provenance = new ProvenanceLedger();
  readonly overlay = new Overlay();
  #base = new Map<string,string>();
  #batch: ChangeBatch;
  #state: 'staging' | 'review' | 'consumed' | 'cancelled' = 'staging';
  #readRevisions = new Map<string,string>();
  #contextExposures: { path: string; revision: string; fidelity: number; bytes: number }[] = [];
  #analysisExposures: {path:string;revision:string;kind:string;digest:string;bytes:number}[]=[];
  constructor(files: readonly Snapshot[], private selection?: { path: string; span: Span }) {
    if(selection) this.selection = { path:selection.path,span:{...selection.span} };
    this.#batch = new ChangeBatch(selection ? { selection } : {});
    for (const f of files) { this.overlay.load(f); this.#base.set(f.path, f.text); }
  }
  #staging() { if (this.#state !== 'staging') throw new Error(`Workbench is ${this.#state}; start a new attempt`); }
  files(): Snapshot[] { return [...this.#base.keys()].map(path => ({ path, text: this.overlay.read(path).text })); }
  addFile(file:Snapshot){this.#staging();if(this.#base.has(file.path))return;this.overlay.load(file);this.#base.set(file.path,file.text);}
  changes(){return this.changedFiles().map(f=>({path:f.path,before:this.#base.get(f.path)!,after:f.text}));}
  openFile(file:Snapshot){this.addFile(file);const current=this.overlay.read(file.path);return {...this.provenance.register({path:file.path,revision:current.revision,line:1,role:'reference',query:'explicit path',excerpt:''}),total_lines:(current.text.match(/[^\n]*\n|[^\n]+$/g)??['']).length};}
  changedFiles() { return this.files().filter(f => this.#base.get(f.path) !== f.text); }
  trace(symbol: string) { this.#staging(); return traceExemplar(this.files(), symbol).map(h => this.provenance.register(h)); }
  discover(symbol:string,budgetBytes:number,offset=0){
    this.#staging();if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(budgetBytes)||budgetBytes<2000||budgetBytes>24000)throw new Error('Invalid discovery page');
    const raw=traceExemplar(this.files(),symbol);const roles=[...new Set(raw.map(h=>h.role))];const groups=roles.map(role=>raw.filter(h=>h.role===role));
    const ordered:typeof raw[number][]=[];for(let i=0;groups.some(g=>g.length>i);i++)for(const group of groups)if(group[i])ordered.push(group[i]!);
    const hits:ReturnType<ProvenanceLedger['register']>[]=[];
    for(const hit of ordered.slice(offset)){
      const candidate={...hit,excerpt:Array.from(hit.excerpt).slice(0,160).join(''),id:'00000000-0000-0000-0000-000000000000'};
      if(Buffer.byteLength(JSON.stringify([...hits,candidate]))>budgetBytes)break;
      hits.push(this.provenance.register(candidate));
    }
    if(!hits.length&&ordered.length>offset)throw new Error('A candidate exceeds this page budget; increase the budget');
    return {hits,total:ordered.length,next:offset+hits.length<ordered.length?offset+hits.length:null,bytes:Buffer.byteLength(JSON.stringify(hits)),budgetBytes,note:'Candidate bytes only. Read near the returned line before staging; more pages are optional.'};
  }
  read(discoveryId: string, path: string, startLine: number, endLine: number) {
    this.#staging(); const file = this.overlay.read(path);
    const text = this.provenance.read(discoveryId, { path, text: file.text }, startLine, endLine);
    // Reading a bounded range does not authorize replacement elsewhere in the file.
    const lines = file.text.match(/[^\n]*\n|[^\n]+$/g) ?? [''];
    const start = lines.slice(0, startLine - 1).join('').length;
    const end = lines.slice(0, endLine).join('').length;
    this.#readRevisions.set(`${path}:${start}:${end}`, file.revision);
    return { text, revision: file.revision, span: { start, end }, path };
  }
  readBounded(id:string,path:string,start:number,requestedEnd:number,maxLines:number,maxBytes:number){
    this.#staging();const text=this.overlay.read(path).text;const lines=text.match(/[^\n]*\n|[^\n]+$/g)??[''];
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||start<1||requestedEnd<start||start>lines.length)throw new Error(`Use start_line 1–${lines.length} and end_line >= start_line`);
    let end=Math.min(requestedEnd,start+maxLines-1,lines.length);
    while(end>=start&&Buffer.byteLength(lines.slice(start-1,end).join(''))>maxBytes)end--;
    if(end<start)throw new Error(`Line ${start} exceeds the ${maxBytes}-byte read budget`);
    const read=this.read(id,path,start,end);
    return {...read,start_line:start,end_line:end,total_lines:lines.length,next_line:end<lines.length?end+1:null,clipped:end!==requestedEnd,note:'Only the returned text/span is authorized read evidence.'};
  }
  stageExact(input: { path:string; revision:string; expected:string; replacement:string }) {
    this.#staging();const file=this.overlay.read(input.path);
    if(file.revision!==input.revision)throw new Error('Stale read; trace and read the staged file again');
    if(!input.expected)throw new Error('Exact-text staging needs a nonempty anchor; use an observed span for insertion');
    const start=file.text.indexOf(input.expected);
    if(start<0||file.text.indexOf(input.expected,start+1)>=0)throw new Error('Expected text must occur exactly once; include more observed context');
    return this.stage({...input,span:{start,end:start+input.expected.length}});
  }
  stage(input: { path: string; revision: string; span: Span; expected: string; replacement: string }) {
    this.#staging(); const file = this.overlay.read(input.path);
    if (file.revision !== input.revision) throw new Error('Stale read; trace and read the staged file again');
    // Reuse exact-range, Unicode, selection and quota validation on the current overlay.
    const proofBatch = new ChangeBatch(this.selection ? { selection: this.selection } : {});
    let covered = false;
    for (const [key, revision] of this.#readRevisions) {
      const match = /^(.*):(\d+):(\d+)$/.exec(key);
      if (match?.[1] === input.path && revision === file.revision && input.span.start >= Number(match[2]) && input.span.end <= Number(match[3])) covered = true;
    }
    if (!covered) throw new Error('Edit lacks current read evidence; read the intended lines first');
    const evidence = proofBatch.observe({ path: input.path, text: file.text }, input.span);
    proofBatch.stage({ evidenceId: evidence.id, span: input.span, expected: input.expected, replacement: input.replacement });
    const after = file.text.slice(0,input.span.start) + input.replacement + file.text.slice(input.span.end);
    // A selection's end follows its own staged replacements, while its start is fixed.
    this.overlay.replace(input.path, file.revision, after);
    if (this.selection) this.selection = { path: this.selection.path, span: { start: this.selection.span.start, end: this.selection.span.end + input.replacement.length - input.expected.length } };
    return { revision: digest(after), staged: true };
  }
  context(budgetBytes: number) {
    this.#staging();
    const seen = new Set<string>(); const candidates: Candidate[] = [];
    for (const r of this.provenance.reads()) {
      if (seen.has(r.discovery.path)) continue; seen.add(r.discovery.path);
      const text = this.overlay.read(r.discovery.path).text;
      if (digest(text) !== r.discovery.revision) { seen.delete(r.discovery.path); continue; }
      const lines = text.split(/\r?\n/);
      const skeleton = lines.filter(l => /^\s*(?:async\s+)?(?:def|class|function|export)\b/.test(l)).join('\n');
      // Level 2 is the observed excerpt, not an invented AST/docstring extraction.
      candidates.push({ id: r.discovery.id, path: r.discovery.path, priority: r.discovery.role === 'definition' ? 10 : 5,
        reason: `Read via ${r.discovery.query} (${r.discovery.role})`, levels: [r.discovery.path, skeleton, r.discovery.excerpt, text] });
    }
    const packed = packContext(candidates,budgetBytes);
    if (this.#contextExposures.length + packed.included.length > 1024) throw new Error('Context exposure limit');
    this.#contextExposures.push(...packed.included.map(c => ({path:c.path,revision:this.overlay.read(c.path).revision,fidelity:c.fidelity,bytes:Buffer.byteLength(c.content)})));
    return packed;
  }
  recordAnalysis(path:string,revision:string,value:unknown){this.#staging();if(this.overlay.read(path).revision!==revision)throw new Error('Analysis revision changed; retry');if(this.#analysisExposures.length>=256)throw new Error('Analysis exposure limit');const text=JSON.stringify(value);this.#analysisExposures.push({path,revision,kind:'Python structure and name summary (not edit authorization)',digest:digest(text),bytes:Buffer.byteLength(text)});}
  ledger() { return {reads:this.provenance.reads(),context:structuredClone(this.#contextExposures),analysis:structuredClone(this.#analysisExposures)}; }
  review() {
    this.#staging();
    // Build transactionally; a failed diff leaves the staging attempt repairable.
    const batch = new ChangeBatch();
    for (const [path,before] of this.#base) {
      const after = this.overlay.read(path).text; if (after === before) continue;
      const proof = batch.observe({ path, text: before }, { start: 0, end: before.length });
      for (const h of replacementHunks({ before, after })) batch.stage({ evidenceId: proof.id, ...h });
    }
    const proposals = batch.freeze(); this.#batch = batch; this.#state = 'review'; this.overlay.freeze();
    return { batchId: batch.id, proposals };
  }
  /** Host-only. Never register this as an MCP tool. */
  accept(ids: readonly string[], current: ReadonlyMap<string,string>): CommitPlan {
    if (this.#state !== 'review') throw new Error('No pending review');
    this.#batch.authorize(ids);
    try { const plan = this.#batch.consume(current); this.#state = 'consumed'; return plan; }
    catch (e) { this.#state = 'cancelled'; throw e; }
  }
  cancel() { this.#state = 'cancelled'; this.overlay.cancel(); this.#readRevisions.clear(); }
}
