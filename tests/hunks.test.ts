import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replacementHunks } from '../src/core/hunks.js';

function apply(before: string, hunks: ReturnType<typeof replacementHunks>): string {
  let result = before;
  for (const hunk of [...hunks].reverse()) result = result.slice(0, hunk.span.start) + hunk.replacement + result.slice(hunk.span.end);
  return result;
}

test('nearby docstring and logic changes remain individually reviewable', () => {
  const before = 'def flag():\n    """Old docs."""\n    value = read()\n    return value == "true"\n';
  const after = 'def flag():\n    """New docs."""\n    value = read()\n    return value.lower() == "true"\n';
  const hunks = replacementHunks({ before, after });
  assert.equal(hunks.length, 2);
  assert.equal(apply(before, hunks), after);
});

test('insertions, deletions, no-final-newline and Unicode round-trip', () => {
  for (const [before, after] of [['', '😀'], ['a\nb\n', 'b\n'], ['x', 'x\n'], ['a\r\nb\r\n', 'a\r\n🦊\r\n'], ['same', 'same']]) {
    assert.equal(apply(before ?? '', replacementHunks({ before: before ?? '', after: after ?? '' })), after);
  }
});

test('selection offsets are preserved without widening the range', () => {
  const hunks = replacementHunks({ before: 'old', after: 'new', offset: 6 });
  assert.deepEqual(hunks[0]?.span, { start: 6, end: 9 });
  assert.equal(apply('prefixold suffix', hunks), 'prefixnew suffix');
});

test('oversized proposals fail instead of blocking interactive review', () => {
  assert.throws(() => replacementHunks({ before: 'a'.repeat(256_001), after: '' }), /size limit/);
});
