/**
 * Import-path mappings from the v1 `@modelcontextprotocol/sdk` package to the
 * v2 split packages (`@modelcontextprotocol/client|server|core|node|...`).
 *
 * Source of truth: docs/migration/upgrade-to-v2.md in
 * modelcontextprotocol/typescript-sdk (verified 2026-07-08, SDK 2.0.0-beta.2).
 * Keys are normalized module specifiers with any trailing `.js` removed.
 */
export interface ImportMapping {
  /** New module specifier; absent when the module was removed outright. */
  to?: string;
  /** Extra guidance shown in the lint message. */
  note?: string;
  fixable: boolean;
}

export const SDK_PACKAGE = '@modelcontextprotocol/sdk';

export const importMap: Record<string, ImportMapping> = {
  '@modelcontextprotocol/sdk/client/index': {
    to: '@modelcontextprotocol/client',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/client': {
    to: '@modelcontextprotocol/client',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/client/stdio': {
    to: '@modelcontextprotocol/client/stdio',
    note: 'stdio transports are not exported from the root barrel in v2.',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/client/streamableHttp': {
    to: '@modelcontextprotocol/client',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/server/index': {
    to: '@modelcontextprotocol/server',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/server': {
    to: '@modelcontextprotocol/server',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/server/mcp': {
    to: '@modelcontextprotocol/server',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/server/stdio': {
    to: '@modelcontextprotocol/server/stdio',
    note: 'stdio transports are not exported from the root barrel in v2.',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/server/streamableHttp': {
    to: '@modelcontextprotocol/node',
    note:
      'StreamableHTTPServerTransport becomes NodeStreamableHTTPServerTransport (Node req/res). ' +
      'On web-standard runtimes use WebStandardStreamableHTTPServerTransport from @modelcontextprotocol/server instead.',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/types': {
    to: '@modelcontextprotocol/core',
    note: 'Spec types and Zod *Schema constants now live in @modelcontextprotocol/core.',
    fixable: true,
  },
  '@modelcontextprotocol/sdk/inMemory': {
    to: '@modelcontextprotocol/server',
    note:
      'InMemoryTransport is exported by both @modelcontextprotocol/server and /client; ' +
      'import from the package matching the side you construct, and never mix packages for one linked pair.',
    fixable: true,
  },
  // Removed modules (no mechanical rewrite).
  '@modelcontextprotocol/sdk/server/sse': {
    note:
      'The HTTP+SSE transport (protocol 2024-11-05) is removed in SDK v2. Migrate to Streamable HTTP; ' +
      'a frozen interim copy exists at @modelcontextprotocol/server-legacy/sse.',
    fixable: false,
  },
  '@modelcontextprotocol/sdk/client/sse': {
    note:
      'SSEClientTransport is removed in SDK v2. Use StreamableHTTPClientTransport from @modelcontextprotocol/client.',
    fixable: false,
  },
  '@modelcontextprotocol/sdk/client/websocket': {
    note:
      'WebSocketClientTransport is removed (WebSocket was never a spec transport). ' +
      'Use StreamableHTTPClientTransport or StdioClientTransport.',
    fixable: false,
  },
  '@modelcontextprotocol/sdk/shared/protocol': {
    note:
      'Protocol and mergeCapabilities have no v2 export. Use fallbackRequestHandler for catch-all dispatch.',
    fixable: false,
  },
  '@modelcontextprotocol/sdk/server/zod-compat': {
    note:
      'zod-compat helpers are removed. Use z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) ' +
      'or fromJsonSchema() from @modelcontextprotocol/server.',
    fixable: false,
  },
  '@modelcontextprotocol/sdk/server/zod-json-schema-compat': {
    note:
      'toJsonSchemaCompat is removed. Use z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) ' +
      'or fromJsonSchema() from @modelcontextprotocol/server.',
    fixable: false,
  },
};

export function normalizeSpecifier(spec: string): string {
  return spec.replace(/\.js$/, '');
}

/** Resolve a v1 SDK module specifier to its mapping (or undefined). */
export function lookupImport(spec: string): ImportMapping | undefined {
  return importMap[normalizeSpecifier(spec)];
}

export function isSdkSpecifier(spec: string): boolean {
  return spec === SDK_PACKAGE || spec.startsWith(`${SDK_PACKAGE}/`);
}
