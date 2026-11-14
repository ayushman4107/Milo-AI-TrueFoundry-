import { randomUUID } from 'node:crypto';
import { digest, type CommitPlan } from './change-batch.js';
import { copyPlan } from './commit-coordinator.js';
import { LIMITS, validatePath, validateText } from './validation.js';

export type VerificationInput = Readonly<{
  plan: CommitPlan;
  inputs: readonly Readonly<{ path: string; digest: string }>[];
  command: Readonly<{ executable: string; args: readonly string[]; cwd: string }>;
  environmentDigest: string;
}>;
export type VerificationReceipt = Readonly<{ id: string; status: 'passed' | 'failed'; identity: string }>;

function hashValue(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Expected SHA-256 digest');
}

/** Fingerprints supplied by the host must cover the full verification tree, including unchanged inputs. */
function identity(input: VerificationInput): string {
  const plan = copyPlan(input.plan);
  hashValue(input.environmentDigest);
  if (input.inputs.length > 100_000 || input.command.args.length > 128) throw new Error('Verification input limit exceeded');
  const aliases = new Set<string>();
  const files = new Map<string, string>();
  for (const file of input.inputs) {
    validatePath(file.path); hashValue(file.digest);
    if (aliases.has(file.path.toLowerCase())) throw new Error('Duplicate verification path alias');
    aliases.add(file.path.toLowerCase()); files.set(file.path, file.digest);
  }
  for (const file of plan.changes) {
    if (files.get(file.path) !== digest(file.after)) throw new Error('Verification tree does not match proposed file');
  }
  const { executable, args, cwd } = input.command;
  if (!executable || [executable, cwd, ...args].some(s => s.length > LIMITS.edit)) throw new Error('Invalid verification command');
  if ([executable, cwd, ...args].reduce((n, s) => n + s.length, 0) > 64_000) throw new Error('Verification command size limit exceeded');
  for (const value of [executable, cwd, ...args]) validateText(value);
  if (cwd !== '.') validatePath(cwd);
  return digest(JSON.stringify({
    changes: [...plan.changes].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(f => [f.path, digest(f.before), digest(f.after)]),
    inputs: [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    command: { executable, args, cwd }, environment: input.environmentDigest,
  }));
}

/** Only the trusted command runner records receipts; these are evidence, never permission to write. */
export class VerificationLedger {
  #records = new Map<string, VerificationReceipt>();

  record(input: VerificationInput, result: { exitCode: number; timedOut: boolean }): VerificationReceipt {
    if (!Number.isSafeInteger(result.exitCode) || typeof result.timedOut !== 'boolean') throw new Error('Invalid process result');
    const receipt = Object.freeze({ id: randomUUID(), identity: identity(input), status: result.exitCode === 0 && !result.timedOut ? 'passed' as const : 'failed' as const });
    if (this.#records.size >= 64) {
      const oldest = this.#records.keys().next().value;
      if (oldest) this.#records.delete(oldest);
    }
    this.#records.set(receipt.id, receipt);
    return receipt;
  }

  status(receiptId: string, current: VerificationInput): 'passed' | 'failed' | 'stale' | 'unknown' {
    const receipt = this.#records.get(receiptId);
    if (!receipt) return 'unknown';
    return receipt.identity === identity(current) ? receipt.status : 'stale';
  }
}
