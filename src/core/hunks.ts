import { diffLines } from 'diff';
import type { Span } from './change-batch.js';

export type Hunk = Readonly<{ span: Span; expected: string; replacement: string }>;

/** Separate changed blocks without merging them merely because display context overlaps. */
export function replacementHunks(input: { before: string; after: string; offset?: number }): readonly Hunk[] {
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid selection offset');
  if (input.before.length + input.after.length > 256_000) throw new Error('Proposal exceeds interactive diff size limit');
  const changes = diffLines(input.before, input.after, { timeout: 100, maxEditLength: 20_000 });
  if (!changes) throw new Error('Diff complexity exceeded; propose a smaller range');
  const hunks: Hunk[] = [];
  let cursor = offset;
  let start = offset;
  let expected = '';
  let replacement = '';
  const flush = (): void => {
    if (expected || replacement) hunks.push(Object.freeze({ span: Object.freeze({ start, end: cursor }), expected, replacement }));
    expected = ''; replacement = '';
  };
  for (const change of changes) {
    if (change.added || change.removed) {
      if (!expected && !replacement) start = cursor;
      if (change.removed) { expected += change.value; cursor += change.value.length; }
      else replacement += change.value;
    } else {
      flush(); cursor += change.value.length;
    }
  }
  flush();
  return Object.freeze(hunks);
}
