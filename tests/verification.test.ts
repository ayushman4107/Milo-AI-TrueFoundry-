import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest } from '../src/core/change-batch.js';
import { VerificationLedger, type VerificationInput } from '../src/core/verification.js';

function request(): VerificationInput {
  return { plan: { batchId: 'b', changes: [{ path: 'a', before: 'old', after: 'new' }] }, inputs: [{ path: 'a', digest: digest('new') }, { path: 'dependency', digest: digest('original') }], command: { executable: 'python', args: ['-m', 'pytest'], cwd: '.' }, environmentDigest: digest('python 3.12; locked dependency versions') };
}
const success = { exitCode: 0, timedOut: false };

test('changed hunk decisions cannot reuse a green verification result', () => {
  const ledger = new VerificationLedger(); const original = request(); const receipt = ledger.record(original, success);
  const selected = { ...original, plan: { batchId: 'b', changes: [{ path: 'a', before: 'old', after: 'partial' }] }, inputs: [{ path: 'a', digest: digest('partial') }, original.inputs[1]!] };
  assert.equal(ledger.status(receipt.id, selected), 'stale');
});

test('unchanged-code dependencies, command args and environment all affect validity', () => {
  const ledger = new VerificationLedger(); const original = request(); const receipt = ledger.record(original, success);
  for (const changed of [
    { ...original, inputs: [original.inputs[0]!, { path: 'dependency', digest: digest('changed') }] },
    { ...original, command: { ...original.command, args: ['-m', 'pytest', '-k', 'different'] } },
    { ...original, environmentDigest: digest('different version') },
  ]) assert.equal(ledger.status(receipt.id, changed), 'stale');
  assert.equal(ledger.status(receipt.id, original), 'passed');
});

test('file ordering and a different batch ID do not invalidate identical verified content', () => {
  const ledger = new VerificationLedger(); const original = request(); const receipt = ledger.record(original, success);
  assert.equal(ledger.status(receipt.id, { ...original, plan: { ...original.plan, batchId: 'other' }, inputs: [...original.inputs].reverse() }), 'passed');
});

test('unknown receipt, failures and timeouts cannot look passed', () => {
  const ledger = new VerificationLedger(); const original = request();
  assert.equal(ledger.status('fabricated', original), 'unknown');
  for (const result of [{ exitCode: 1, timedOut: false }, { exitCode: 0, timedOut: true }]) {
    const receipt = ledger.record(original, result); assert.equal(ledger.status(receipt.id, original), 'failed');
  }
});

test('verification must describe the exact staged tree', () => {
  const ledger = new VerificationLedger();
  assert.throws(() => ledger.record({ ...request(), inputs: [] }, success), /does not match/);
  assert.throws(() => ledger.record({ ...request(), inputs: [{ path: 'a', digest: digest('different') }] }, success), /does not match/);
});
