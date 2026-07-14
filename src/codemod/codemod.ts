import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../core/types.js';
import { applyEdits } from '../core/edits.js';
import { collectFiles, lintText, type LintOptions } from '../lint/linter.js';
import { unifiedDiff } from './diff.js';

export interface CodemodFileResult {
  file: string;
  before: string;
  after: string;
  fixesApplied: number;
  /** Findings that remain after all fixes (manual review). */
  remaining: Finding[];
}

export interface CodemodOptions extends LintOptions {
  write?: boolean;
  /** Version range used when rewriting @modelcontextprotocol/* dependencies. */
  sdkVersionRange?: string;
}

export interface CodemodRunResult {
  results: CodemodFileResult[];
  changedFiles: number;
  totalFixes: number;
  manualFindings: Finding[];
}

const MAX_PASSES = 4;
const DEFAULT_SDK_RANGE = '^2.0.0-beta.2';
const V2_PACKAGE_RE = /@modelcontextprotocol\/(client|server|core|node|express|hono|fastify|server-legacy)/g;

/** Fix a single file's text: iterate lint→apply until stable. */
export function codemodText(
  filePath: string,
  text: string,
  options: CodemodOptions = {},
): { after: string; fixesApplied: number; remaining: Finding[] } {
  let current = text;
  let fixesApplied = 0;
  let remaining: Finding[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const findings = lintText(filePath, current, options);
    const edits = findings.flatMap((f) => f.fix ?? []);
    remaining = findings.filter((f) => !f.fix);
    if (edits.length === 0) break;
    const { text: next, applied } = applyEdits(current, edits);
    fixesApplied += applied;
    if (next === current) break;
    current = next;
  }
  return { after: current, fixesApplied, remaining };
}

/**
 * Rewrite the @modelcontextprotocol/sdk dependency in package.json to the v2
 * split packages actually used by the (already-fixed) source files.
 */
export function rewritePackageJson(
  text: string,
  usedPackages: Set<string>,
  sdkVersionRange = DEFAULT_SDK_RANGE,
): string {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
  let touched = false;
  for (const section of ['dependencies', 'devDependencies']) {
    const deps = json[section] as Record<string, string> | undefined;
    if (!deps || !Object.prototype.hasOwnProperty.call(deps, '@modelcontextprotocol/sdk')) continue;
    delete deps['@modelcontextprotocol/sdk'];
    const targets = usedPackages.size > 0 ? [...usedPackages] : ['@modelcontextprotocol/server'];
    for (const pkg of targets.sort()) {
      deps[pkg] = sdkVersionRange;
    }
    json[section] = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
    touched = true;
  }
  if (!touched) return text;
  const indentMatch = /^(\s+)"/m.exec(text);
  const indent = indentMatch?.[1] ?? '  ';
  return JSON.stringify(json, null, indent) + '\n';
}

export function runCodemod(paths: string[], options: CodemodOptions = {}): CodemodRunResult {
  const files = collectFiles(paths);
  const results: CodemodFileResult[] = [];
  const usedPackages = new Set<string>();
  const packageJsonFiles: { file: string; text: string }[] = [];

  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    if (path.basename(file) === 'package.json') {
      packageJsonFiles.push({ file, text: before });
      continue;
    }
    const { after, fixesApplied, remaining } = codemodText(file, before, options);
    for (const match of after.matchAll(V2_PACKAGE_RE)) {
      // server-legacy is transitional but still a real dependency if imported.
      usedPackages.add(`@modelcontextprotocol/${match[1]}`);
    }
    results.push({ file, before, after, fixesApplied, remaining });
  }

  for (const { file, text } of packageJsonFiles) {
    // Apply direct fixes (e.g. zod range) first, then the dependency swap.
    const { after: fixed, fixesApplied, remaining } = codemodText(file, text, options);
    const after = rewritePackageJson(fixed, usedPackages, options.sdkVersionRange);
    results.push({
      file,
      before: text,
      after,
      fixesApplied: fixesApplied + (after !== fixed ? 1 : 0),
      remaining: remaining.filter((f) => f.ruleId !== 'v2-sdk-dependency' || after === fixed),
    });
  }

  if (options.write) {
    for (const r of results) {
      if (r.after !== r.before) fs.writeFileSync(r.file, r.after);
    }
  }

  const changed = results.filter((r) => r.after !== r.before);
  return {
    results,
    changedFiles: changed.length,
    totalFixes: results.reduce((acc, r) => acc + r.fixesApplied, 0),
    manualFindings: results.flatMap((r) => r.remaining),
  };
}

export function renderDiffs(run: CodemodRunResult, cwd = process.cwd()): string {
  const parts: string[] = [];
  for (const r of run.results) {
    if (r.after === r.before) continue;
    parts.push(unifiedDiff(r.before, r.after, path.relative(cwd, r.file) || r.file));
  }
  return parts.join('\n');
}
