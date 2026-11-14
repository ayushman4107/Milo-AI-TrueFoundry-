export const LIMITS = Object.freeze({ file: 1_000_000, batch: 8_000_000, edit: 256_000, files: 128, evidence: 1024, proposals: 512 });

export function validateText(text: string): void {
  // In Unicode mode paired surrogates are a single code point and do not match.
  if (typeof text !== 'string' || /[\uD800-\uDFFF]/u.test(text)) throw new Error('Invalid Unicode text');
  if (text.includes('\0')) throw new Error('Binary text is not supported');
}

/** Portable lexical identity only; the filesystem adapter must still resolve symlinks and hardlinks. */
export function validatePath(path: string): void {
  validateText(path);
  if (!path || path.length > 1024 || path !== path.normalize('NFC') || /[\\:<>"|?*\p{Cc}\p{Cf}]/u.test(path)) throw new Error('Invalid repository-relative path');
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) {
      throw new Error('Invalid repository-relative path');
    }
  }
}

export function validateRange(span: { start: number; end: number }): void {
  if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end < span.start) throw new Error('Invalid UTF-16 text range');
}
