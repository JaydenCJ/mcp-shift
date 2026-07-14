/**
 * Era detection ("backward-compatibility probing" per the 2026-07-28
 * Streamable HTTP draft): try a modern request first; a recognized modern
 * JSON-RPC error on HTTP 400 still identifies a modern server; otherwise fall
 * back to a legacy `initialize`.
 */
import crypto from 'node:crypto';
import { DEFAULT_LEGACY_NEGOTIATED_VERSION, MODERN_PROTOCOL_VERSION, VERSION } from './version.js';
import { injectEnvelope } from './proxy/envelope.js';
import { ErrorCodes, isSuccess, type JsonRpcRequest } from './proxy/jsonrpc.js';
import { postUpstream } from './proxy/http.js';

export interface DetectResult {
  era: 'modern' | 'legacy' | 'unknown';
  /** Best-known protocol version(s) the server speaks. */
  protocolVersions: string[];
  serverInfo?: Record<string, unknown>;
  detail: string;
}

const PROXY_IDENTITY = {
  clientInfo: { name: 'mcp-shift-detect', version: VERSION },
  clientCapabilities: {},
};

export async function detectEra(url: string): Promise<DetectResult> {
  // 1. Modern probe: server/discover with the 2026 envelope + headers.
  const discover: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: `mcp-shift-detect-${crypto.randomUUID()}`,
    method: 'server/discover',
    params: {},
  };
  const stamped = injectEnvelope(discover, PROXY_IDENTITY) as JsonRpcRequest;
  try {
    const modern = await postUpstream(url, stamped, {
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': 'server/discover',
    });
    if (modern.kind === 'json' && modern.message) {
      if (isSuccess(modern.message)) {
        const result = modern.message.result;
        // DiscoverResult.supportedVersions (schema/draft/schema.json).
        const versions = Array.isArray(result['supportedVersions'])
          ? (result['supportedVersions'] as string[])
          : [MODERN_PROTOCOL_VERSION];
        const out: DetectResult = {
          era: 'modern',
          protocolVersions: versions,
          detail: 'server/discover answered — 2026-07-28 (stateless) server',
        };
        const info = (result['serverInfo'] ?? result['identity']) as
          | Record<string, unknown>
          | undefined;
        if (info) out.serverInfo = info;
        return out;
      }
      if ('error' in modern.message) {
        const code = modern.message.error.code;
        if (
          code === ErrorCodes.UnsupportedProtocolVersion ||
          code === ErrorCodes.HeaderMismatch ||
          code === ErrorCodes.MissingRequiredClientCapability
        ) {
          const data = modern.message.error.data as { supported?: string[] } | undefined;
          return {
            era: 'modern',
            protocolVersions: data?.supported ?? [MODERN_PROTOCOL_VERSION],
            detail: `modern error ${code} on probe — 2026-era server (recognized spec-reserved code)`,
          };
        }
      }
    }
  } catch {
    // fall through to the legacy probe
  }

  // 2. Legacy probe: initialize.
  const init: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: `mcp-shift-detect-${crypto.randomUUID()}`,
    method: 'initialize',
    params: {
      protocolVersion: DEFAULT_LEGACY_NEGOTIATED_VERSION,
      capabilities: {},
      clientInfo: PROXY_IDENTITY.clientInfo,
    },
  };
  try {
    const legacy = await postUpstream(url, init, {});
    if (legacy.kind === 'json' && legacy.message && isSuccess(legacy.message)) {
      const result = legacy.message.result;
      const version =
        typeof result['protocolVersion'] === 'string'
          ? (result['protocolVersion'] as string)
          : DEFAULT_LEGACY_NEGOTIATED_VERSION;
      const sessionId = legacy.headers.get('mcp-session-id');
      // Be polite: terminate the probe session if the server minted one.
      if (sessionId) {
        void fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } }).catch(
          () => {},
        );
      }
      const out: DetectResult = {
        era: 'legacy',
        protocolVersions: [version],
        detail: `initialize answered (negotiated ${version}) — 2025-era server${sessionId ? ', session-managed' : ''}`,
      };
      const info = result['serverInfo'] as Record<string, unknown> | undefined;
      if (info) out.serverInfo = info;
      return out;
    }
    return {
      era: 'unknown',
      protocolVersions: [],
      detail: `Neither server/discover nor initialize succeeded (last HTTP status ${legacy.status})`,
    };
  } catch (err) {
    return {
      era: 'unknown',
      protocolVersions: [],
      detail: `Probe failed: ${(err as Error).message}`,
    };
  }
}
