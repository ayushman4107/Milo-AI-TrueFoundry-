import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeBatch, inversePlan } from '../src/core/change-batch.js';
import { replacementHunks } from '../src/core/hunks.js';

test('1000 seeded edit/review/undo cases round-trip without corrupting untouched text', () => {
  let seed = 0x4d494c4f;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const choices = ['a', 'long line', '😀', 'é', '中文', '', 'two words', '\tindent'];
  const text = () => Array.from({ length: next() % 10 }, () => choices[next() % choices.length] ?? '').join(next() % 2 ? '\n' : '\r\n');
  for (let i = 0; i < 1000; i++) {
    const before = text(); const after = text(); const hunks = replacementHunks({ before, after });
    if (!hunks.length) { assert.equal(before, after); continue; }
    const batch = new ChangeBatch(); const proof = batch.observe({ path: 'sample.txt', text: before }, { start: 0, end: before.length });
    const proposals = hunks.map(h => batch.stage({ evidenceId: proof.id, ...h })); batch.freeze();
    const accepted = proposals.filter((_, n) => n === 0 || next() % 2);
    batch.authorize(accepted.map(p => p.id));
    const plan = batch.consume(new Map([['sample.txt', before]]));
    let expected = before;
    for (const p of [...accepted].reverse()) expected = expected.slice(0, p.span.start) + p.replacement + expected.slice(p.span.end);
    assert.equal(plan.changes[0]?.after, expected, `seed case ${i}`);
    assert.equal(inversePlan(plan, new Map([['sample.txt', expected]])).changes[0]?.after, before);
    let full = before;
    for (const h of [...hunks].reverse()) full = full.slice(0, h.span.start) + h.replacement + full.slice(h.span.end);
    assert.equal(full, after);
  }
});
