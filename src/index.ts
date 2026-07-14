/** mcp-shift — public library surface. */
export { VERSION, TARGET_SPEC_REVISION, TARGET_SPEC_STATUS, SUPPORTED_SPEC_VERSIONS } from './version.js';
export type { SpecVersion } from './version.js';
export type { Finding, Rule, RuleMeta, Severity, TextEdit, Tier } from './core/types.js';
export { applyEdits } from './core/edits.js';
export { lintText, lintPaths, collectFiles, type LintOptions } from './lint/linter.js';
export { formatPretty, formatJson, summarize } from './lint/format.js';
export { astRules, packageJsonRules, allRuleMetas } from './rules/index.js';
export {
  codemodText,
  runCodemod,
  renderDiffs,
  rewritePackageJson,
  type CodemodOptions,
  type CodemodRunResult,
} from './codemod/codemod.js';
export { unifiedDiff } from './codemod/diff.js';
export { detectEra, type DetectResult } from './detect.js';
export { startProxy, resolveFront, type ProxyOptions, type RunningProxy, type Front } from './proxy/proxy.js';
export { LegacyFront } from './proxy/legacyFront.js';
export { ModernFront } from './proxy/modernFront.js';
export {
  META,
  injectEnvelope,
  readEnvelope,
  stripEnvelope,
  stripModernResultFields,
  injectModernResultFields,
  CACHEABLE_METHODS,
} from './proxy/envelope.js';
export { encodeHeaderValue, decodeHeaderValue, isHeaderSafe, mcpNameParam } from './proxy/headers.js';
export { SseParser, serializeSseEvent, type SseEvent } from './proxy/sse.js';
export { ErrorCodes } from './proxy/jsonrpc.js';
