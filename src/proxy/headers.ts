/**
 * 2026-07-28 Streamable HTTP header helpers.
 *
 * Every POST carries `MCP-Protocol-Version` and `Mcp-Method`; `tools/call`,
 * `resources/read` and `prompts/get` additionally carry `Mcp-Name` mirroring
 * `params.name` / `params.uri`. Values that are not header-safe use the
 * Base64 sentinel encoding `=?base64?{value}?=` (SEP-2575/2243).
 */

const SENTINEL_RE = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/;

/** Printable ASCII without leading/trailing whitespace, and not sentinel-shaped. */
export function isHeaderSafe(value: string): boolean {
  if (value.length === 0) return false;
  if (!/^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/.test(value)) return false;
  if (value.startsWith('=?')) return false;
  return true;
}

export function encodeHeaderValue(value: string): string {
  if (isHeaderSafe(value)) return value;
  return `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function decodeHeaderValue(value: string): string {
  const match = SENTINEL_RE.exec(value);
  if (!match) return value;
  return Buffer.from(match[1]!, 'base64').toString('utf8');
}

/** The `Mcp-Name` source for a given method, if the method requires one. */
export function mcpNameParam(method: string): 'name' | 'uri' | undefined {
  switch (method) {
    case 'tools/call':
    case 'prompts/get':
      return 'name';
    case 'resources/read':
      return 'uri';
    default:
      return undefined;
  }
}

export function headerNameForParam(paramName: string): string {
  return `Mcp-Param-${paramName}`;
}
