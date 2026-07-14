/**
 * End-to-end: a NEW (2026-07-28) client talks through the proxy to an OLD
 * (2025-era) server fixture. Direction B of the compatibility bridge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProxy, type RunningProxy } from '../src/proxy/proxy.js';
import { startLegacyServer, type LegacyServerFixture } from './helpers/legacyServer.js';

let fixture: LegacyServerFixture;
let proxy: RunningProxy;

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CLIENT = 'io.modelcontextprotocol/clientInfo';
const META_LOG = 'io.modelcontextprotocol/logLevel';

function modernBody(id: number, method: string, params: Record<string, unknown> = {}): unknown {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [META_VERSION]: '2026-07-28',
        [META_CLIENT]: { name: 'new-client', version: '2.0.0' },
      },
    },
  };
}

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(proxy.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  fixture = await startLegacyServer();
  proxy = await startProxy({ upstreamUrl: fixture.url, front: 'auto' });
});

afterAll(async () => {
  await proxy.close();
  await fixture.close();
});

describe('modern front (2026-07-28 client → old server)', () => {
  it('auto-detects the legacy upstream and serves the 2026 era southbound', () => {
    expect(proxy.front).toBe('2026');
  });

  it('rejects GET and DELETE with 405 (POST-only endpoint)', async () => {
    const get = await fetch(proxy.url, { method: 'GET' });
    expect(get.status).toBe(405);
    const del = await fetch(proxy.url, { method: 'DELETE' });
    expect(del.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
  });

  it('rejects a missing MCP-Protocol-Version header with 400 + -32022 and the supported list', async () => {
    const res = await post(modernBody(1, 'tools/list'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toEqual(['2026-07-28']);
  });

  it('rejects an unsupported version (e.g. 2025-11-25) with -32022', async () => {
    const res = await post(modernBody(2, 'tools/list'), {
      'mcp-protocol-version': '2025-11-25',
      'mcp-method': 'tools/list',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.requested).toBe('2025-11-25');
  });

  it('rejects an Mcp-Method header that does not match the body with -32020 HeaderMismatch', async () => {
    const res = await post(modernBody(3, 'tools/list'), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32020);
  });

  it('rejects a missing/mismatched Mcp-Name on tools/call with -32020', async () => {
    const missing = await post(modernBody(4, 'tools/call', { name: 'echo', arguments: { text: 'x' } }), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
    });
    expect((await missing.json()).error.code).toBe(-32020);
    const mismatched = await post(modernBody(5, 'tools/call', { name: 'echo', arguments: { text: 'x' } }), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'other-tool',
    });
    expect((await mismatched.json()).error.code).toBe(-32020);
  });

  it('answers removed methods (initialize, ping) with 404 + -32601', async () => {
    for (const method of ['initialize', 'ping']) {
      const res = await post(modernBody(6, method), {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe(-32601);
    }
  });

  it('answers unbridgeable 2026 methods (subscriptions/listen, tasks/*) with 404 + -32601 itself', async () => {
    for (const method of ['subscriptions/listen', 'tasks/get', 'tasks/list']) {
      const res = await post(modernBody(14, method), {
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe(-32601);
      // Never forwarded: the 2025 upstream would answer HTTP 200 + in-body
      // -32601, which is not how a 2026-only endpoint reports this.
      expect(fixture.log.map((r) => r.method)).not.toContain(method);
    }
  });

  it('synthesizes server/discover from the cached upstream initialize', async () => {
    const res = await post(modernBody(7, 'server/discover'), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'server/discover',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.resultType).toBe('complete');
    expect(body.result.serverInfo).toEqual({ name: 'legacy-fixture', version: '1.0.0' });
    // DiscoverResult.supportedVersions per schema/draft/schema.json.
    expect(body.result.supportedVersions).toEqual(['2026-07-28']);
    // All members the schema marks required must be present:
    // cacheScope, capabilities, resultType, serverInfo, supportedVersions, ttlMs.
    expect(body.result.capabilities).toBeDefined();
    expect(typeof body.result.ttlMs).toBe('number');
    expect(['public', 'private']).toContain(body.result.cacheScope);
    // Upstream got a real 2025 handshake exactly once with the client's
    // identity (the earlier `initialize` in the log is the era-detection
    // probe from `front: 'auto'`, which politely DELETEs its session).
    const inits = fixture.log.filter(
      (r) => r.method === 'initialize' && r.body.params.clientInfo?.name === 'new-client',
    );
    expect(inits).toHaveLength(1);
    expect(fixture.log.filter((r) => r.method === 'notifications/initialized')).toHaveLength(1);
  });

  it('forwards tools/list stripping the envelope and pinning the upstream session, upgrading the result', async () => {
    const res = await post(modernBody(8, 'tools/list'), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    });
    const body = await res.json();
    // 2026 result upgrades:
    expect(body.result.resultType).toBe('complete');
    expect(body.result.ttlMs).toBe(0);
    expect(body.result.cacheScope).toBe('private');
    expect(body.result.tools[0].name).toBe('echo');

    const upstreamReq = fixture.log.findLast((r) => r.method === 'tools/list')!;
    // The 2025 session header is attached northbound; modern headers are not.
    expect(upstreamReq.headers['mcp-session-id']).toBe('legacy-fixture-session-1');
    expect(upstreamReq.headers['mcp-method']).toBeUndefined();
    // Envelope keys must not leak into the 2025 body.
    expect(upstreamReq.body.params?._meta).toBeUndefined();
  });

  it('calls a tool end-to-end with Mcp-Name validated southbound', async () => {
    const res = await post(modernBody(9, 'tools/call', { name: 'echo', arguments: { text: 'hi' } }), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'echo',
    });
    const body = await res.json();
    expect(body.result.resultType).toBe('complete');
    expect(body.result.content[0].text).toBe('legacy-echo:hi');
    expect(body.result.ttlMs).toBeUndefined(); // tools/call is not cacheable
  });

  it('accepts Base64-sentinel-encoded Mcp-Name headers', async () => {
    const res = await post(modernBody(10, 'tools/call', { name: 'echo', arguments: { text: 'x' } }), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': `=?base64?${Buffer.from('echo').toString('base64')}?=`,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).result.resultType).toBe('complete');
  });

  it('maps the per-request logLevel envelope key to upstream logging/setLevel (deduplicated)', async () => {
    const withLevel = (id: number) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/list',
      params: {
        _meta: {
          [META_VERSION]: '2026-07-28',
          [META_CLIENT]: { name: 'new-client', version: '2.0.0' },
          [META_LOG]: 'warning',
        },
      },
    });
    await post(withLevel(11), { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' });
    await post(withLevel(12), { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' });
    expect(fixture.setLevelCalls).toEqual(['warning']); // set once, deduplicated
  });

  it('re-maps the 2025 resource-not-found code -32002 to -32602', async () => {
    const res = await post(modernBody(13, 'resources/read', { uri: 'file:///missing.txt' }), {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'resources/read',
      'mcp-name': 'file:///missing.txt',
    });
    const body = await res.json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('missing.txt');
  });
});
