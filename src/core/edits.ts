import type { TextEdit } from './types.js';

export interface ApplyResult {
  text: string;
  applied: number;
  /** Edits skipped because they overlapped an earlier edit. */
  skipped: number;
}

/**
 * Apply a set of text edits to `text`. Edits are sorted by start offset;
 * overlapping edits are skipped (a later lint pass will pick them up again).
 */
export function applyEdits(text: string, edits: TextEdit[]): ApplyResult {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let cursor = 0;
  let applied = 0;
  let skipped = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) {
      skipped++;
      continue;
    }
    out += text.slice(cursor, edit.start);
    out += edit.text;
    cursor = edit.end;
    applied++;
  }
  out += text.slice(cursor);
  return { text: out, applied, skipped };
}
