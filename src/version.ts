/** Package version (kept in sync with package.json by release tooling). */
export const VERSION = '0.1.0';

/**
 * The MCP spec revision this release targets.
 *
 * IMPORTANT: the final 2026-07-28 specification has not shipped yet (it lands
 * on 2026-07-28). All `2026`-tier rules, codemod mappings and proxy behavior
 * in this release track the release candidate that was locked on 2026-05-21,
 * as published in the spec repo's `draft` changelog. Re-verify against
 * https://modelcontextprotocol.io/specification/2026-07-28/changelog once the
 * final revision is published.
 */
export const TARGET_SPEC_REVISION = '2026-07-28';
export const TARGET_SPEC_STATUS = 'RC (locked 2026-05-21, final ships 2026-07-28)';

/** Spec revisions understood by the lint `--spec-version` flag. */
export const SUPPORTED_SPEC_VERSIONS = ['2026-07-28', '2025-11-25'] as const;
export type SpecVersion = (typeof SUPPORTED_SPEC_VERSIONS)[number];

/** Protocol revisions of the "2025 era" (single wire codec per the TS SDK). */
export const LEGACY_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
] as const;

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const DEFAULT_LEGACY_NEGOTIATED_VERSION = '2025-11-25';
