import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeBatch, inversePlan } from '../src/core/change-batch.js';
import { LIMITS } from '../src/core/validation.js';

test('file and evidence quotas fail without poisoning existing valid observations', () => {
  const batch = new ChangeBatch();
  assert.throws(() => batch.observe({ path: 'too-large', text: 'a'.repeat(LIMITS.file + 1) }, { start: 0, end: 1 }), /limit/);
  for (let i = 0; i < LIMITS.evidence; i++) batch.observe({ path: 'a', text: 'abc' }, { start: 0, end: 3 });
  assert.throws(() => batch.observe({ path: 'a', text: 'abc' }, { start: 0, end: 3 }), /limit/);
});

test('many small files cannot bypass batch size and file-count quotas', () => {
  const batch = new ChangeBatch();
  for (let i = 0; i < LIMITS.files; i++) batch.observe({ path: `file-${i}`, text: 'a' }, { start: 0, end: 1 });
  assert.throws(() => batch.observe({ path: 'extra', text: 'a' }, { start: 0, end: 1 }), /limit/);
  const large = new ChangeBatch();
  for (let i = 0; i < LIMITS.batch / LIMITS.file; i++) large.observe({ path: `file-${i}`, text: 'a'.repeat(LIMITS.file) }, { start: 0, end: 1 });
  assert.throws(() => large.observe({ path: 'extra', text: 'a' }, { start: 0, end: 1 }), /limit/);
});

test('a selection boundary cannot bisect a surrogate even when observed range is valid', () => {
  const batch = new ChangeBatch({ selection: { path: 'a', span: { start: 0, end: 1 } } });
  assert.throws(() => batch.observe({ path: 'a', text: '😀' }, { start: 0, end: 2 }), /Unicode/);
});

test('undo rejects duplicate aliases in a supplied plan', () => {
  assert.throws(() => inversePlan({ batchId: 'x', changes: [{ path: 'a', before: 'old', after: 'new' }, { path: 'A', before: 'other', after: 'new' }] }, new Map([['a','new'],['A','new']])), /alias/);
});
