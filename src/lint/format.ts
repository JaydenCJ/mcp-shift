import path from 'node:path';
import type { Finding } from '../core/types.js';

export interface Summary {
  errors: number;
  warnings: number;
  fixable: number;
}

export function summarize(findings: Finding[]): Summary {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    fixable: findings.filter((f) => f.fix && f.fix.length > 0).length,
  };
}

export function formatPretty(findings: Finding[], cwd = process.cwd()): string {
  if (findings.length === 0) {
    return 'No migration issues found.\n';
  }
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  const lines: string[] = [];
  for (const [file, list] of byFile) {
    lines.push(path.relative(cwd, file) || file);
    for (const f of list) {
      const sev = f.severity === 'error' ? 'error' : 'warn ';
      const fixable = f.fix ? ' (fixable)' : '';
      lines.push(`  ${f.line}:${f.column}  ${sev}  ${f.message}  [${f.ruleId}]${fixable}`);
    }
    lines.push('');
  }
  const s = summarize(findings);
  lines.push(
    `${findings.length} problem${findings.length === 1 ? '' : 's'} ` +
      `(${s.errors} error${s.errors === 1 ? '' : 's'}, ${s.warnings} warning${s.warnings === 1 ? '' : 's'})` +
      (s.fixable > 0 ? ` — ${s.fixable} fixable with \`mcp-shift codemod --write\`` : ''),
  );
  return lines.join('\n') + '\n';
}

export function formatJson(findings: Finding[]): string {
  return (
    JSON.stringify(
      findings.map(({ fix, ...rest }) => ({ ...rest, fixable: Boolean(fix) })),
      null,
      2,
    ) + '\n'
  );
}
