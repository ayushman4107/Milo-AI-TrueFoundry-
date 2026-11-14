import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeBatch, digest } from '../src/core/change-batch.js';
import { replacementHunks } from '../src/core/hunks.js';

test('reject portable path escapes and aliases at the core boundary', () => {
  for (const path of ['../outside', '/absolute', 'C:/Windows/a', 'a/../b', 'a\\b', 'a//b', 'a.', 'a ', 'a:stream', 'CON.txt', 'a/./b', 'a\u0000b']) {
    assert.throws(() => new ChangeBatch().observe({ path, text: 'a' }, { start: 0, end: 1 }), path);
  }
});

test('case aliases cannot create two plans for the same Windows file', () => {
  const batch = new ChangeBatch();
  batch.observe({ path: 'Test.py', text: 'a' }, { start: 0, end: 1 });
  assert.throws(() => batch.observe({ path: 'test.py', text: 'b' }, { start: 0, end: 1 }), /alias/i);
});

test('a malformed selection cannot silently disable scope enforcement', () => {
  assert.throws(() => new ChangeBatch({ selection: { path: 'a', span: { start: NaN, end: Infinity } } }));
});

test('oversized edits cannot bypass the diff helper and exhaust staging memory', () => {
  const batch = new ChangeBatch();
  const evidence = batch.observe({ path: 'a', text: 'a' }, { start: 0, end: 1 });
  assert.throws(() => batch.stage({ evidenceId: evidence.id, span: { start: 0, end: 1 }, expected: 'a', replacement: 'x'.repeat(256_001) }), /limit/i);
});

test('malformed UTF-16 cannot collapse distinct inputs to the same UTF-8 digest', () => {
  assert.throws(() => digest('\ud800'), /Unicode/i);
  assert.throws(() => replacementHunks({ before: 'good', after: '\ud801' }), /Unicode/i);
});

test('detecting a conflict revokes authorization even if old content later returns', () => {
  const batch = new ChangeBatch();
  const proof = batch.observe({ path: 'a', text: 'old' }, { start: 0, end: 3 });
  const edit = batch.stage({ evidenceId: proof.id, span: { start: 0, end: 3 }, expected: 'old', replacement: 'new' });
  batch.freeze(); batch.authorize([edit.id]);
  assert.throws(() => batch.consume(new Map([['a', 'changed']])));
  assert.throws(() => batch.consume(new Map([['a', 'old']])), /cancelled|conflict/i);
});

test('an unsafe integer offset must not yield rounded hunk coordinates', () => {
  assert.throws(() => replacementHunks({ before: 'x', after: 'y', offset: Number.MAX_SAFE_INTEGER }));
});
