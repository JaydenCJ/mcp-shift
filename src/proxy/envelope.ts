import { MODERN_PROTOCOL_VERSION } from '../version.js';
import type { JsonRpcNotification, JsonRpcRequest } from './jsonrpc.js';

/** Reserved `_meta` envelope keys of the 2026-07-28 revision (SEP-2575). */
export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  logLevel: 'io.modelcontextprotocol/logLevel',
  subscriptionId: 'io.modelcontextprotocol/subscriptionId',
} as const;

export interface EnvelopeIdentity {
  clientInfo?: Record<string, unknown>;
  clientCapabilities?: Record<string, unknown>;
  logLevel?: string;
}

type Meta = Record<string, unknown>;

function getMeta(msg: JsonRpcRequest | JsonRpcNotification): Meta | undefined {
  const params = msg.params;
  if (!params || typeof params !== 'object') return undefined;
  const meta = (params as Record<string, unknown>)['_meta'];
  return meta && typeof meta === 'object' ? (meta as Meta) : undefined;
}

/** Stamp the per-request identity envelope onto an outbound 2026-era message. */
export function injectEnvelope(
  msg: JsonRpcRequest | JsonRpcNotification,
  identity: EnvelopeIdentity,
): JsonRpcRequest | JsonRpcNotification {
  const params: Record<string, unknown> = { ...(msg.params ?? {}) };
  const meta: Meta = { ...((params['_meta'] as Meta | undefined) ?? {}) };
  meta[META.protocolVersion] = MODERN_PROTOCOL_VERSION;
  if (identity.clientInfo) meta[META.clientInfo] = identity.clientInfo;
  if (identity.clientCapabilities) meta[META.clientCapabilities] = identity.clientCapabilities;
  if (identity.logLevel !== undefined) meta[META.logLevel] = identity.logLevel;
  params['_meta'] = meta;
  return { ...msg, params };
}

/** Read the envelope from an inbound 2026-era message. */
export function readEnvelope(msg: JsonRpcRequest | JsonRpcNotification): {
  protocolVersion?: string;
  clientInfo?: Record<string, unknown>;
  clientCapabilities?: Record<string, unknown>;
  logLevel?: string;
} {
  const meta = getMeta(msg);
  if (!meta) return {};
  return {
    protocolVersion: meta[META.protocolVersion] as string | undefined,
    clientInfo: meta[META.clientInfo] as Record<string, unknown> | undefined,
    clientCapabilities: meta[META.clientCapabilities] as Record<string, unknown> | undefined,
    logLevel: meta[META.logLevel] as string | undefined,
  };
}

/** Remove all io.modelcontextprotocol/* envelope keys (northbound to a 2025 server). */
export function stripEnvelope(
  msg: JsonRpcRequest | JsonRpcNotification,
): JsonRpcRequest | JsonRpcNotification {
  const params = msg.params;
  if (!params || typeof params !== 'object') return msg;
  const meta = (params as Record<string, unknown>)['_meta'];
  if (!meta || typeof meta !== 'object') return msg;
  const nextMeta: Meta = {};
  for (const [key, value] of Object.entries(meta as Meta)) {
    if (!key.startsWith('io.modelcontextprotocol/')) nextMeta[key] = value;
  }
  const nextParams: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  if (Object.keys(nextMeta).length > 0) {
    nextParams['_meta'] = nextMeta;
  } else {
    delete nextParams['_meta'];
  }
  if (Object.keys(nextParams).length === 0) {
    const { params: _params, ...rest } = msg;
    return rest as JsonRpcRequest | JsonRpcNotification;
  }
  return { ...msg, params: nextParams };
}

/** Result fields introduced by 2026-07-28 that 2025-era strict parsers may reject. */
export const MODERN_RESULT_FIELDS = ['resultType', 'ttlMs', 'cacheScope'] as const;

/** Methods whose results are CacheableResult in 2026-07-28 (SEP-2549). */
export const CACHEABLE_METHODS = new Set([
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/read',
  'resources/templates/list',
]);

/** Strip 2026-only result members before forwarding to a 2025 client. */
export function stripModernResultFields(result: Record<string, unknown>): Record<string, unknown> {
  const next = { ...result };
  for (const field of MODERN_RESULT_FIELDS) delete next[field];
  return next;
}

/** Add required 2026 result members when forwarding a 2025 result to a 2026 client. */
export function injectModernResultFields(
  result: Record<string, unknown>,
  method: string,
): Record<string, unknown> {
  const next = { ...result };
  if (next['resultType'] === undefined) next['resultType'] = 'complete';
  if (CACHEABLE_METHODS.has(method)) {
    // Conservative defaults mirroring the TS SDK's legacy bridging.
    if (next['ttlMs'] === undefined) next['ttlMs'] = 0;
    if (next['cacheScope'] === undefined) next['cacheScope'] = 'private';
  }
  return next;
}
