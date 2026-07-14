import fs from 'node:fs';
import path from 'node:path';
import type { Finding, ReportInput, Rule } from '../core/types.js';
import { parseSource } from '../core/parse.js';
import { astRules, packageJsonRules } from '../rules/index.js';
import type { SpecVersion } from '../version.js';

export interface LintOptions {
  /**
   * Target spec revision. `2026-07-28` (default) enables both `v2` and `2026`
   * tiers; `2025-11-25` limits linting to the SDK v1→v2 surface (`v2` tier).
   */
  specVersion?: SpecVersion;
  /** Restrict to specific rule IDs. */
  rules?: string[];
}

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.build', 'out', 'coverage', '.git']);

function activeAstRules(options: LintOptions): Rule[] {
  const spec = options.specVersion ?? '2026-07-28';
  return astRules.filter((rule) => {
    if (options.rules && !options.rules.includes(rule.meta.id)) return false;
    if (spec === '2025-11-25' && rule.meta.tier === '2026') return false;
    return true;
  });
}

export function lintText(filePath: string, text: string, options: LintOptions = {}): Finding[] {
  if (path.basename(filePath) === 'package.json') {
    return lintPackageJson(filePath, text, options);
  }
  const findings: Finding[] = [];
  const sourceFile = parseSource(filePath, text);
  for (const rule of activeAstRules(options)) {
    const report = (input: ReportInput): void => {
      const start = input.start ?? input.node?.getStart(sourceFile) ?? 0;
      const pos = sourceFile.getLineAndCharacterOfPosition(start);
      findings.push({
        ruleId: rule.meta.id,
        severity: input.severity ?? rule.meta.severity,
        tier: rule.meta.tier,
        message: input.message,
        file: filePath,
        line: pos.line + 1,
        column: pos.character + 1,
        ...(input.fix ? { fix: input.fix } : {}),
      });
    };
    rule.check({ sourceFile, text, filePath, report });
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

export function lintPackageJson(
  filePath: string,
  text: string,
  options: LintOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return findings;
  }
  const spec = options.specVersion ?? '2026-07-28';
  for (const rule of packageJsonRules) {
    if (options.rules && !options.rules.includes(rule.meta.id)) continue;
    if (spec === '2025-11-25' && rule.meta.tier === '2026') continue;
    rule.check({
      filePath,
      text,
      json,
      report(input) {
        const before = text.slice(0, input.index);
        const line = before.split('\n').length;
        const column = input.index - before.lastIndexOf('\n');
        findings.push({
          ruleId: rule.meta.id,
          severity: input.severity ?? rule.meta.severity,
          tier: rule.meta.tier,
          message: input.message,
          file: filePath,
          line,
          column,
          ...(input.fix ? { fix: input.fix } : {}),
        });
      },
    });
  }
  return findings;
}

export function collectFiles(paths: string[]): string[] {
  const files: string[] = [];
  const visit = (p: string): void => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (IGNORED_DIRS.has(path.basename(p))) return;
      for (const entry of fs.readdirSync(p).sort()) {
        visit(path.join(p, entry));
      }
      return;
    }
    const base = path.basename(p);
    if (base === 'package.json' || SOURCE_EXTS.has(path.extname(p))) {
      if (base.endsWith('.d.ts')) return;
      files.push(p);
    }
  };
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      throw new Error(`Path not found: ${p}`);
    }
    visit(p);
  }
  return files;
}

export interface LintRunResult {
  findings: Finding[];
  fileCount: number;
}

export function lintPaths(paths: string[], options: LintOptions = {}): LintRunResult {
  const files = collectFiles(paths);
  const findings: Finding[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    findings.push(...lintText(file, text, options));
  }
  return { findings, fileCount: files.length };
}
