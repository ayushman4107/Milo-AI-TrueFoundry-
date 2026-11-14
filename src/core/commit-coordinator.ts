import { randomUUID } from 'node:crypto';
import type { CommitPlan } from './change-batch.js';
import { LIMITS, validatePath, validateText } from './validation.js';

export type CommitTicket = Readonly<{ id: string }>;
export interface AtomicEditorPort {
  read(paths: readonly string[], signal: AbortSignal): Promise<ReadonlyMap<string, string>>;
  // Adapter MUST recheck revisions at the mutation boundary and apply all text changes or none.
  compareAndSwap(plan: CommitPlan, signal: AbortSignal): Promise<'applied' | 'rejected'>;
}
export type CommitResult =
  | { status: 'applied' | 'applied_after_cancel' | 'cancelled' | 'conflict' }
  | { status: 'failed' | 'recovery_required'; reason: string };

async function boundedRead(port: AtomicEditorPort, paths: readonly string[], signal: AbortSignal): Promise<ReadonlyMap<string, string>> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  if (combined.aborted) throw combined.reason;
  let onAbort = (): void => {};
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(combined.reason); combined.addEventListener('abort', onAbort, { once: true }); });
  try { return await Promise.race([Promise.resolve().then(() => port.read(paths, combined)), aborted]); }
  finally { combined.removeEventListener('abort', onAbort); }
}

export function copyPlan(plan: CommitPlan): CommitPlan {
  if (!plan.changes.length || plan.changes.length > LIMITS.files) throw new Error('Invalid commit plan size');
  const seen = new Set<string>();
  let characters = 0;
  const changes = plan.changes.map(file => {
    validatePath(file.path);
    if (file.before.length > LIMITS.file || file.after.length > LIMITS.file) throw new Error('File size limit exceeded');
    validateText(file.before); validateText(file.after);
    if (seen.has(file.path.toLowerCase())) throw new Error('Duplicate path alias in commit plan');
    seen.add(file.path.toLowerCase());
    characters += file.before.length + file.after.length;
    if (characters > LIMITS.batch * 2) throw new Error('Commit plan capacity limit exceeded');
    return Object.freeze({ path: file.path, before: file.before, after: file.after });
  });
  return Object.freeze({ batchId: plan.batchId, changes: Object.freeze(changes) });
}

/** Host-owned tickets bridge review and async editor I/O without exposing replayable write grants. */
export class CommitCoordinator {
  #controller = new AbortController();
  #epoch = 0;
  #busy = false;
  #recoveryRequired = false;
  #recoveryPlan: CommitPlan | undefined;
  #tickets = new WeakMap<CommitTicket, { plan: CommitPlan; epoch: number }>();

  startRun(): void {
    if (this.#busy || this.#recoveryRequired) throw new Error('Commit or recovery is still pending');
    this.cancel();
    this.#controller = new AbortController();
  }

  cancel(): void { this.#epoch++; this.#controller.abort(); }

  issue(plan: CommitPlan): CommitTicket {
    if (this.#controller.signal.aborted || this.#busy || this.#recoveryRequired) throw new Error('Run is cancelled or commit is pending');
    const ticket = Object.freeze({ id: randomUUID() });
    this.#tickets.set(ticket, { plan: copyPlan(plan), epoch: this.#epoch });
    return ticket;
  }

  async apply(ticket: CommitTicket, port: AtomicEditorPort): Promise<CommitResult> {
    if (this.#busy || this.#recoveryRequired) throw new Error('Commit or recovery is still pending');
    const issued = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    if (!issued) throw new Error('Unknown or consumed commit ticket');
    const signal = this.#controller.signal;
    if (issued.epoch !== this.#epoch || signal.aborted) return { status: 'cancelled' };
    this.#busy = true;
    let dispatched = false;
    try {
      const current = await boundedRead(port, issued.plan.changes.map(f => f.path), signal);
      if (signal.aborted) return { status: 'cancelled' };
      if (issued.plan.changes.some(f => current.get(f.path) !== f.before)) return { status: 'conflict' };
      dispatched = true;
      const result = await port.compareAndSwap(issued.plan, signal);
      if (result === 'applied') return { status: signal.aborted ? 'applied_after_cancel' : 'applied' };
      return { status: signal.aborted ? 'cancelled' : 'conflict' };
    } catch (error) {
      this.#recoveryRequired = dispatched;
      if (dispatched) this.#recoveryPlan = issued.plan;
      if (!dispatched && signal.aborted) return { status: 'cancelled' };
      return { status: dispatched ? 'recovery_required' : 'failed', reason: error instanceof Error ? error.message : String(error) };
    } finally { this.#busy = false; }
  }

  /** Inspect an uncertain commit without writing; mixed outcomes require explicit manual reconciliation. */
  async recover(port: AtomicEditorPort): Promise<'not_needed' | 'unchanged' | 'applied' | 'manual_review_required'> {
    if (this.#busy) throw new Error('Commit or recovery is still pending');
    if (!this.#recoveryPlan) return 'not_needed';
    this.#busy = true;
    try {
      const current = await boundedRead(port, this.#recoveryPlan.changes.map(f => f.path), new AbortController().signal);
      const before = this.#recoveryPlan.changes.every(f => current.get(f.path) === f.before);
      const after = this.#recoveryPlan.changes.every(f => current.get(f.path) === f.after);
      if (!before && !after) return 'manual_review_required';
      this.cancel();
      this.#recoveryPlan = undefined;
      this.#recoveryRequired = false;
      return after ? 'applied' : 'unchanged';
    } finally { this.#busy = false; }
  }
}
