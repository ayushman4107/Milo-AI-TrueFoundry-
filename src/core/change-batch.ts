import { createHash, randomUUID } from 'node:crypto';
import { LIMITS, validatePath, validateRange, validateText } from './validation.js';
import { copyPlan } from './commit-coordinator.js';

export type Snapshot = Readonly<{ path: string; text: string }>;
export type Span = Readonly<{ start: number; end: number }>;
export type Evidence = Readonly<{ id: string; path: string; digest: string; span: Span }>;
export type Proposal = Readonly<{ id: string; evidenceId: string; path: string; span: Span; replacement: string }>;
export type FileChange = Readonly<{ path: string; before: string; after: string }>;
export type CommitPlan = Readonly<{ batchId: string; changes: readonly FileChange[] }>;
type BatchState = 'staging' | 'review' | 'authorized' | 'consumed' | 'cancelled';

export function digest(text: string): string {
  validateText(text);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validateSpan(text: string, span: Span): void {
  validateRange(span);
  if (span.end > text.length) {
    throw new Error('Invalid UTF-16 text range');
  }
  for (const offset of [span.start, span.end]) {
    const previous = text.charCodeAt(offset - 1);
    const next = text.charCodeAt(offset);
    if ((previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) ||
        (text[offset - 1] === '\r' && text[offset] === '\n')) {
      throw new Error('Range splits a Unicode character or CRLF newline');
    }
  }
}

function touches(a: Span, b: Span): boolean {
  if (a.start === a.end || b.start === b.end) return a.start <= b.end && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

/** Immutable evidence and one-use review decisions; never performs filesystem writes. */
export class ChangeBatch {
  readonly id = randomUUID();
  private state: BatchState = 'staging';
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly evidence = new Map<string, Evidence>();
  private readonly proposals = new Map<string, Proposal>();
  private accepted = new Set<string>();
  private retainedCharacters = 0;
  private readonly selection: Readonly<{ path: string; span: Span }> | undefined;

  constructor(options: { selection?: { path: string; span: Span } } = {}) {
    if (options.selection) { validatePath(options.selection.path); validateRange(options.selection.span); }
    this.selection = options.selection ? { path: options.selection.path, span: { ...options.selection.span } } : undefined;
  }

  observe(snapshot: Snapshot, span: Span): Evidence {
    this.require('staging');
    validatePath(snapshot.path);
    if (snapshot.text.length > LIMITS.file) throw new Error('File size limit exceeded');
    validateText(snapshot.text);
    validateSpan(snapshot.text, span);
    const existing = this.snapshots.get(snapshot.path);
    for (const path of this.snapshots.keys()) {
      if (path !== snapshot.path && path.toLowerCase() === snapshot.path.toLowerCase()) throw new Error('Case alias conflicts with existing file');
    }
    if (existing && existing.text !== snapshot.text) throw new Error('File changed during discovery; start a new batch');
    if (this.selection?.path === snapshot.path) validateSpan(snapshot.text, this.selection.span);
    if (this.evidence.size >= LIMITS.evidence || (!existing && this.snapshots.size >= LIMITS.files) || this.retainedCharacters + (existing ? 0 : snapshot.text.length) > LIMITS.batch) throw new Error('Batch capacity limit exceeded');
    this.retainedCharacters += existing ? 0 : snapshot.text.length;
    this.snapshots.set(snapshot.path, Object.freeze({ ...snapshot }));
    const proof = Object.freeze({ id: randomUUID(), path: snapshot.path, digest: digest(snapshot.text), span: Object.freeze({ ...span }) });
    this.evidence.set(proof.id, proof);
    return proof;
  }

  stage(input: { evidenceId: string; span: Span; expected: string; replacement: string }): Proposal {
    this.require('staging');
    if (input.replacement.length + input.expected.length > LIMITS.edit || this.proposals.size >= LIMITS.proposals || this.retainedCharacters + input.replacement.length > LIMITS.batch) throw new Error('Proposal size or capacity limit exceeded');
    validateText(input.replacement);
    const proof = this.evidence.get(input.evidenceId);
    const source = proof && this.snapshots.get(proof.path);
    if (!proof || !source) throw new Error('Unknown read evidence');
    validateSpan(source.text, input.span);
    if (input.span.start < proof.span.start || input.span.end > proof.span.end) throw new Error('Edit exceeds observed range');
    if (this.selection && (source.path !== this.selection.path || input.span.start < this.selection.span.start || input.span.end > this.selection.span.end)) {
      throw new Error('Edit exceeds inline selection');
    }
    if (source.text.slice(input.span.start, input.span.end) !== input.expected) throw new Error('Expected text does not match evidence');
    if (input.expected === input.replacement) throw new Error('No-op proposal');
    for (const other of this.proposals.values()) {
      if (other.path === source.path && touches(other.span, input.span)) throw new Error('Overlapping proposals require a new batch');
    }
    const projectedLength = [...this.proposals.values()].filter(p => p.path === source.path).reduce((size, p) => size + p.replacement.length - (p.span.end - p.span.start), source.text.length) + input.replacement.length - (input.span.end - input.span.start);
    if (projectedLength > LIMITS.file) throw new Error('Resulting file size limit exceeded');
    const proposal = Object.freeze({ id: randomUUID(), evidenceId: proof.id, path: source.path, span: Object.freeze({ ...input.span }), replacement: input.replacement });
    this.proposals.set(proposal.id, proposal);
    this.retainedCharacters += input.replacement.length;
    return proposal;
  }

  freeze(): readonly Proposal[] {
    this.require('staging');
    if (!this.proposals.size) throw new Error('No proposals to review');
    this.state = 'review';
    return Object.freeze([...this.proposals.values()]);
  }

  authorize(acceptedIds: readonly string[]): void {
    this.require('review');
    if (!acceptedIds.length) throw new Error('No accepted changes; cancel the batch instead');
    if (new Set(acceptedIds).size !== acceptedIds.length) throw new Error('Duplicate review decision');
    for (const id of acceptedIds) if (!this.proposals.has(id)) throw new Error('Unknown proposal in review decision');
    this.accepted = new Set(acceptedIds);
    this.state = 'authorized';
  }

  /** The editor adapter must apply this plan atomically with revision guards; consuming is not applying. */
  consume(current: ReadonlyMap<string, string>): CommitPlan {
    this.require('authorized');
    const changes: FileChange[] = [];
    for (const source of this.snapshots.values()) {
      const edits = [...this.proposals.values()].filter(p => p.path === source.path && this.accepted.has(p.id));
      if (!edits.length) continue;
      if (current.get(source.path) !== source.text) {
        this.cancel();
        throw new Error(`Stale review: ${source.path}; authorization revoked`);
      }
      let after = source.text;
      for (const edit of edits.sort((a, b) => b.span.start - a.span.start)) {
        after = after.slice(0, edit.span.start) + edit.replacement + after.slice(edit.span.end);
      }
      changes.push(Object.freeze({ path: source.path, before: source.text, after }));
    }
    this.state = 'consumed';
    this.accepted.clear();
    return Object.freeze({ batchId: this.id, changes: Object.freeze(changes) });
  }

  cancel(): void {
    if (this.state === 'consumed') throw new Error('Commit plan already issued; adapter must resolve the in-flight commit');
    this.state = 'cancelled';
    this.accepted.clear();
  }

  private require(expected: BatchState): void {
    if (this.state !== expected) throw new Error(`Batch is ${this.state}; expected ${expected}`);
  }
}

export function inversePlan(plan: CommitPlan, current: ReadonlyMap<string, string>): CommitPlan {
  plan = copyPlan(plan);
  for (const file of plan.changes) {
    if (current.get(file.path) !== file.after) throw new Error(`Undo conflict: ${file.path}`);
  }
  return Object.freeze({ batchId: plan.batchId, changes: Object.freeze(plan.changes.map(file => Object.freeze({ path: file.path, before: file.after, after: file.before }))) });
}
