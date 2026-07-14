import type ts from 'typescript';

export type Severity = 'error' | 'warn';

/**
 * Rule tiers:
 * - `v2`   — TypeScript SDK v1 → v2 surface breaks (always relevant when
 *            moving off `@modelcontextprotocol/sdk`).
 * - `2026` — MCP 2026-07-28 protocol adoption issues (stateless transport,
 *            removed methods, renumbered error codes, deprecations).
 */
export type Tier = 'v2' | '2026';

/** A single text replacement, expressed as absolute offsets into the file. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  tier: Tier;
  message: string;
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** Present when the finding is mechanically fixable by `mcp-shift codemod`. */
  fix?: TextEdit[];
}

export interface RuleMeta {
  id: string;
  tier: Tier;
  severity: Severity;
  summary: string;
  fixable: boolean;
}

export interface ReportInput {
  /** Node the finding is anchored to (start position is used for line/col). */
  node?: ts.Node;
  /** Explicit offset (used instead of `node` when provided). */
  start?: number;
  message: string;
  fix?: TextEdit[];
  severity?: Severity;
}

export interface RuleContext {
  sourceFile: ts.SourceFile;
  text: string;
  filePath: string;
  report(input: ReportInput): void;
}

export interface Rule {
  meta: RuleMeta;
  check(ctx: RuleContext): void;
}

/** Rules that operate on package.json instead of a TS/JS AST. */
export interface PackageJsonRuleContext {
  filePath: string;
  text: string;
  json: Record<string, unknown>;
  report(input: { index: number; message: string; fix?: TextEdit[]; severity?: Severity }): void;
}

export interface PackageJsonRule {
  meta: RuleMeta;
  check(ctx: PackageJsonRuleContext): void;
}
