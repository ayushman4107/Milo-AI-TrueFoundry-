import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeBatch, inversePlan } from '../src/core/change-batch.js';

function observed(text = 'one\r\ntwo\r\nthree\r\n') {
  const batch = new ChangeBatch();
  const evidence = batch.observe({ path: 'file.py', text }, { start: 0, end: text.length });
  return { batch, evidence, text };
}

test('selective decisions preserve rejected text and original CRLF bytes', () => {
  const { batch, evidence, text } = observed();
  const a = batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 3 }, expected: 'one', replacement: 'first' });
  batch.stage({ evidenceId: evidence.id, span: { start: 5, end: 8 }, expected: 'two', replacement: 'second' });
  batch.freeze(); batch.authorize([a.id]);
  const plan = batch.consume(new Map([['file.py', text]]));
  assert.equal(plan.changes[0]?.after, 'first\r\ntwo\r\nthree\r\n');
  const undo = inversePlan(plan, new Map([['file.py', 'first\r\ntwo\r\nthree\r\n']]));
  assert.equal(undo.changes[0]?.after, text);
  assert.throws(() => batch.consume(new Map([['file.py', text]])), /consumed/);
});

test('one stale file prevents the entire multi-file plan', () => {
  const batch = new ChangeBatch();
  const ids = ['a', 'b', 'c'].map(path => {
    const proof = batch.observe({ path, text: 'old' }, { start: 0, end: 3 });
    return batch.stage({ evidenceId: proof.id, span: { start: 0, end: 3 }, expected: 'old', replacement: 'new' }).id;
  });
  batch.freeze(); batch.authorize(ids);
  assert.throws(() => batch.consume(new Map([['a', 'old'], ['b', 'USER EDIT'], ['c', 'old']])), /Stale review/);
});

test('cancellation revokes authorization and cannot be reversed by late events', () => {
  const { batch, evidence, text } = observed();
  const p = batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 3 }, expected: 'one', replacement: 'new' });
  batch.freeze(); batch.authorize([p.id]); batch.cancel(); batch.cancel();
  assert.throws(() => batch.consume(new Map([['file.py', text]])), /cancelled/);
  assert.throws(() => batch.authorize([p.id]), /cancelled/);
});

test('selection scope survives an agent reading the whole file', () => {
  const batch = new ChangeBatch({ selection: { path: 'a', span: { start: 2, end: 4 } } });
  const proof = batch.observe({ path: 'a', text: 'abcdef' }, { start: 0, end: 6 });
  assert.throws(() => batch.stage({ evidenceId: proof.id, span: { start: 0, end: 1 }, expected: 'a', replacement: 'Z' }), /selection/);
});

test('unread edits, wrong original text, and overlapping edits fail closed', () => {
  const { batch, evidence } = observed();
  assert.throws(() => batch.stage({ evidenceId: 'invented', span: { start: 0, end: 1 }, expected: 'o', replacement: 'X' }), /Unknown/);
  assert.throws(() => batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 1 }, expected: 'z', replacement: 'X' }), /does not match/);
  batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 3 }, expected: 'one', replacement: 'X' });
  assert.throws(() => batch.stage({ evidenceId: evidence.id, span: { start: 1, end: 3 }, expected: 'ne', replacement: 'Y' }), /Overlapping/);
});

test('read capabilities cannot authorize unseen ranges', () => {
  const batch = new ChangeBatch();
  const proof = batch.observe({ path: 'a', text: 'abcdef' }, { start: 0, end: 2 });
  assert.throws(() => batch.stage({ evidenceId: proof.id, span: { start: 0, end: 3 }, expected: 'abc', replacement: 'X' }), /observed range/);
});

test('UTF-16 surrogate and CRLF boundaries cannot be split', () => {
  const batch = new ChangeBatch();
  assert.throws(() => batch.observe({ path: 'a', text: '😀' }, { start: 0, end: 1 }), /Unicode/);
  assert.throws(() => batch.observe({ path: 'a', text: '\r\n' }, { start: 0, end: 1 }), /CRLF/);
});

test('undo refuses to overwrite subsequent user changes', () => {
  const { batch, evidence, text } = observed();
  const p = batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 3 }, expected: 'one', replacement: 'new' });
  batch.freeze(); batch.authorize([p.id]);
  const plan = batch.consume(new Map([['file.py', text]]));
  assert.throws(() => inversePlan(plan, new Map([['file.py', 'my later edit']])), /Undo conflict/);
});

test('model cannot mutate a frozen review or authorize nonexistent proposals', () => {
  const { batch, evidence } = observed();
  batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 3 }, expected: 'one', replacement: 'new' });
  batch.freeze();
  assert.throws(() => batch.stage({ evidenceId: evidence.id, span: { start: 5, end: 8 }, expected: 'two', replacement: 'X' }), /review/);
  assert.throws(() => batch.authorize(['made-up']), /Unknown/);
  assert.throws(() => batch.consume(new Map()), /review/);
});
