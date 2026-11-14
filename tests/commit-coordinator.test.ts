import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommitCoordinator, type AtomicEditorPort } from '../src/core/commit-coordinator.js';

const plan = { batchId: 'batch', changes: [{ path: 'a', before: 'old', after: 'new' }] };
function gate<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Gate not ready'); };
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function memoryPort(): AtomicEditorPort {
  return { read: async () => new Map([['a', 'old']]), compareAndSwap: async () => 'applied' };
}

test('cancel after ticket issuance prevents every write', async () => {
  const coordinator = new CommitCoordinator();
  const ticket = coordinator.issue(plan); coordinator.cancel();
  const port = memoryPort(); port.compareAndSwap = async () => { throw new Error('Must not reach write'); };
  assert.equal((await coordinator.apply(ticket, port)).status, 'cancelled');
});

test('cancel during asynchronous read fences the subsequent write', async () => {
  const coordinator = new CommitCoordinator(); const read = gate<ReadonlyMap<string,string>>();
  let writes = 0;
  const port: AtomicEditorPort = { read: () => read.promise, compareAndSwap: async () => { writes++; return 'applied'; } };
  const pending = coordinator.apply(coordinator.issue(plan), port);
  coordinator.cancel(); read.resolve(new Map([['a', 'old']]));
  assert.equal((await pending).status, 'cancelled'); assert.equal(writes, 0);
});

test('cancel crossing the atomic commit reports the applied outcome honestly', async () => {
  const coordinator = new CommitCoordinator(); const commit = gate<'applied' | 'rejected'>(); const started = gate<void>();
  const port: AtomicEditorPort = { read: async () => new Map([['a', 'old']]), compareAndSwap: () => { started.resolve(); return commit.promise; } };
  const pending = coordinator.apply(coordinator.issue(plan), port);
  await started.promise; coordinator.cancel();
  assert.throws(() => coordinator.startRun(), /pending/);
  commit.resolve('applied'); assert.equal((await pending).status, 'applied_after_cancel');
});

test('ticket is one-use and an identical-looking object grants nothing', async () => {
  const coordinator = new CommitCoordinator(); const ticket = coordinator.issue(plan);
  await assert.rejects(coordinator.apply({ id: ticket.id }, memoryPort()), /Unknown/);
  assert.equal((await coordinator.apply(ticket, memoryPort())).status, 'applied');
  await assert.rejects(coordinator.apply(ticket, memoryPort()), /consumed/);
});

test('starting a new run invalidates every prior ticket', async () => {
  const coordinator = new CommitCoordinator(); const ticket = coordinator.issue(plan);
  coordinator.startRun(); assert.equal((await coordinator.apply(ticket, memoryPort())).status, 'cancelled');
});

test('post-check edit is rejected by compare-and-swap adapter', async () => {
  const coordinator = new CommitCoordinator(); const port = memoryPort(); port.compareAndSwap = async () => 'rejected';
  assert.equal((await coordinator.apply(coordinator.issue(plan), port)).status, 'conflict');
});

test('uncertain commit failure requires recovery and blocks new work', async () => {
  const coordinator = new CommitCoordinator(); const port = memoryPort(); port.compareAndSwap = async () => { throw new Error('Lost editor connection'); };
  assert.equal((await coordinator.apply(coordinator.issue(plan), port)).status, 'recovery_required');
  assert.throws(() => coordinator.startRun(), /recovery/);
});

test('mutating caller plan after review cannot change ticket contents', async () => {
  const mutable = { batchId: 'x', changes: [{ path: 'a', before: 'old', after: 'reviewed' }] };
  const coordinator = new CommitCoordinator(); const ticket = coordinator.issue(mutable); mutable.changes[0]!.after = 'unreviewed';
  const port = memoryPort(); port.compareAndSwap = async p => { assert.equal(p.changes[0]?.after, 'reviewed'); return 'applied'; };
  assert.equal((await coordinator.apply(ticket, port)).status, 'applied');
});

test('recovery inspects an uncertain outcome without silently rolling back user content', async () => {
  const coordinator = new CommitCoordinator(); const port = memoryPort();
  port.compareAndSwap = async () => { throw new Error('Uncertain write'); };
  await coordinator.apply(coordinator.issue(plan), port);
  port.read = async () => new Map([['a', 'later user edit']]);
  assert.equal(await coordinator.recover(port), 'manual_review_required');
  assert.throws(() => coordinator.startRun(), /recovery/);
  port.read = async () => new Map([['a', 'new']]);
  assert.equal(await coordinator.recover(port), 'applied');
  coordinator.startRun();
  assert.equal(await coordinator.recover(port), 'not_needed');
});

test('a failed read consumes the ticket but does not claim an uncertain write', async () => {
  const coordinator = new CommitCoordinator(); const port = memoryPort(); const ticket = coordinator.issue(plan);
  port.read = async () => { throw new Error('Read failed'); };
  assert.equal((await coordinator.apply(ticket, port)).status, 'failed');
  await assert.rejects(coordinator.apply(ticket, port), /consumed/);
  coordinator.startRun();
});

test('an uncooperative read cannot prevent local cancellation', async () => {
  const coordinator = new CommitCoordinator(); const port = memoryPort();
  port.read = () => new Promise(() => {});
  const pending = coordinator.apply(coordinator.issue(plan), port); coordinator.cancel();
  assert.equal((await pending).status, 'cancelled'); coordinator.startRun();
});
