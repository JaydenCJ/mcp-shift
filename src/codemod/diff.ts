/** Minimal unified diff (LCS-based) for codemod dry-run output. */

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  return dp;
}

type Op = { kind: ' ' | '-' | '+'; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  const dp = lcsMatrix(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: '-', line: a[i]! });
      i++;
    } else {
      ops.push({ kind: '+', line: b[j]! });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: '-', line: a[i++]! });
  while (j < b.length) ops.push({ kind: '+', line: b[j++]! });
  return ops;
}

const MAX_DIFF_LINES = 20000;

export function unifiedDiff(before: string, after: string, filePath: string, context = 3): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length + b.length > MAX_DIFF_LINES) {
    return `--- a/${filePath}\n+++ b/${filePath}\n@@ file rewritten (${a.length} -> ${b.length} lines) @@\n`;
  }
  const ops = diffOps(a, b);

  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let aLine = 1;
  let bLine = 1;
  let hunk: { aStart: number; bStart: number; lines: string[]; aCount: number; bCount: number } | null =
    null;
  let trailingContext = 0;

  const flush = (): void => {
    if (!hunk) return;
    // Trim trailing context beyond `context` lines.
    while (trailingContext > context) {
      hunk.lines.pop();
      hunk.aCount--;
      hunk.bCount--;
      trailingContext--;
    }
    out.push(`@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`);
    out.push(...hunk.lines);
    hunk = null;
    trailingContext = 0;
  };

  const pending: Op[] = [];
  for (const op of ops) {
    if (op.kind === ' ') {
      if (hunk) {
        hunk.lines.push(` ${op.line}`);
        hunk.aCount++;
        hunk.bCount++;
        trailingContext++;
        if (trailingContext >= context * 2) flush();
      } else {
        pending.push(op);
        if (pending.length > context) pending.shift();
      }
      aLine++;
      bLine++;
    } else {
      if (!hunk) {
        hunk = {
          aStart: aLine - pending.length,
          bStart: bLine - pending.length,
          lines: pending.map((p) => ` ${p.line}`),
          aCount: pending.length,
          bCount: pending.length,
        };
        pending.length = 0;
      }
      trailingContext = 0;
      hunk.lines.push(`${op.kind}${op.line}`);
      if (op.kind === '-') {
        hunk.aCount++;
        aLine++;
      } else {
        hunk.bCount++;
        bLine++;
      }
    }
  }
  flush();
  return out.join('\n') + '\n';
}
