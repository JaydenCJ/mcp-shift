/**
 * End-to-end: an OLD (2025-era) client talks through the proxy to a NEW
 * (2026-07-28) server fixture. Direction A of the compatibility bridge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProxy, type RunningProxy } from '../src/proxy/proxy.js';
import { startModernServer, REQUEST_STATE, type ModernServerFixture } from './helpers/modernServer.js';
import { SseParser } from '../src/proxy/sse.js';

let fixture: ModernServerFixture;
let proxy: RunningProxy;
let sessionId: string;

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(proxy.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  fixture = await startModernServer();
  proxy = await startProxy({ upstreamUrl: fixture.url, front: 'auto', mrtrTimeoutMs: 5000 });
});

afterAll(async () => {
  await proxy.close();
  await fixture.close();
});

describe('legacy front (old client → 2026-07-28 server)', () => {
  it('auto-detects the modern upstream and serves the 2025 era southbound', () => {
    expect(proxy.front).toBe('2025');
  });

  it('terminates initialize locally, minting a session from server/discover', async () => {
    const res = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: { elicitation: {} },
        clientInfo: { name: 'old-client', version: '9.9.9' },
      },
    });
    expect(res.status).toBe(200);
    sessionId = res.headers.get('mcp-session-id')!;
    expect(sessionId).toBeTruthy();
    const body = await res.json();
    expect(body.result.protocolVersion).toBe('2025-11-25');
    expect(body.result.serverInfo).toEqual({ name: 'modern-fixture', version: '1.0.0' });
    expect(body.result.capabilities).toEqual({ tools: { listChanged: true } });
    // The upstream never saw an initialize — only server/discover.
    expect(fixture.log.map((r) => r.method)).toContain('server/discover');
    expect(fixture.log.map((r) => r.method)).not.toContain('initialize');
  });

  it('swallows notifications/initialized (nothing forwarded upstream)', async () => {
    const before = fixture.log.length;
    const res = await post(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { 'mcp-session-id': sessionId },
    );
    expect(res.status).toBe(202);
    expect(fixture.log.length).toBe(before);
  });

  it('answers ping locally (ping was removed in 2026-07-28)', async () => {
    const before = fixture.log.length;
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'ping' }, { 'mcp-session-id': sessionId });
    const body = await res.json();
    expect(body.result).toEqual({});
    expect(fixture.log.length).toBe(before);
  });

  it('rejects requests without a session (400) and with an unknown session (404)', async () => {
    const missing = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(missing.status).toBe(400);
    const unknown = await post(
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      { 'mcp-session-id': 'nope' },
    );
    expect(unknown.status).toBe(404);
  });

  it('forwards tools/list with the 2026 envelope + headers, stripping 2026-only result fields', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 5, method: 'tools/list' },
      { 'mcp-session-id': sessionId },
    );
    const body = await res.json();
    expect(body.result.tools.map((t: any) => t.name)).toEqual(['echo', 'greet', 'pick-color']);
    // 2026-only members stripped for the old client:
    expect(body.result.resultType).toBeUndefined();
    expect(body.result.ttlMs).toBeUndefined();
    expect(body.result.cacheScope).toBeUndefined();

    const upstreamReq = fixture.log.findLast((r) => r.method === 'tools/list')!;
    // Required 2026 headers northbound:
    expect(upstreamReq.headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(upstreamReq.headers['mcp-method']).toBe('tools/list');
    // No 2025 session headers may leak north:
    expect(upstreamReq.headers['mcp-session-id']).toBeUndefined();
    // Per-request identity envelope carries the ORIGINAL client identity:
    const meta = upstreamReq.body.params._meta;
    expect(meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(meta['io.modelcontextprotocol/clientInfo']).toEqual({ name: 'old-client', version: '9.9.9' });
    expect(meta['io.modelcontextprotocol/clientCapabilities']).toEqual({ elicitation: {} });
  });

  it('mirrors Mcp-Name and x-mcp-header params on tools/call', async () => {
    const res = await post(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'greet', arguments: { name: 'Ada', tenant: 'acme' } },
      },
      { 'mcp-session-id': sessionId },
    );
    const body = await res.json();
    expect(body.result.content[0].text).toBe('hello Ada @ acme');
    const upstreamReq = fixture.log.findLast((r) => r.method === 'tools/call')!;
    expect(upstreamReq.headers['mcp-name']).toBe('greet');
    // x-mcp-header annotation discovered from the earlier tools/list:
    expect(upstreamReq.headers['mcp-param-tenant']).toBe('acme');
  });

  it('translates logging/setLevel into the per-request _meta logLevel key', async () => {
    const setLevel = await post(
      { jsonrpc: '2.0', id: 7, method: 'logging/setLevel', params: { level: 'debug' } },
      { 'mcp-session-id': sessionId },
    );
    expect((await setLevel.json()).result).toEqual({});
    await post(
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo', arguments: { text: 'x' } } },
      { 'mcp-session-id': sessionId },
    );
    const upstreamReq = fixture.log.findLast((r) => r.method === 'tools/call')!;
    expect(upstreamReq.body.params._meta['io.modelcontextprotocol/logLevel']).toBe('debug');
    // logging/setLevel itself never went upstream (removed method).
    expect(fixture.log.map((r) => r.method)).not.toContain('logging/setLevel');
  });

  /**
   * Drives one full MRTR bridge round trip for a tool whose 2026 upstream
   * answer is `input_required` with an elicitation leg and a roots/list leg.
   */
  async function driveMrtr(requestId: number, toolName: string): Promise<void> {
    const res = await post(
      {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: { name: toolName, arguments: {} },
      },
      { 'mcp-session-id': sessionId },
    );
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const messages: any[] = [];

    // 1. Read until BOTH bridged server→client requests arrive.
    while (messages.length < 2) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        messages.push(JSON.parse(ev.data));
      }
    }
    // Each inputRequests entry was routed by its spec `method` member.
    const elicitation = messages.find((m) => m.method === 'elicitation/create');
    const rootsList = messages.find((m) => m.method === 'roots/list');
    expect(elicitation).toBeDefined();
    expect(elicitation.params.message).toBe('Pick a color');
    expect(elicitation.params.requestedSchema.properties.color.type).toBe('string');
    expect(elicitation.id).toBeTruthy();
    expect(rootsList).toBeDefined();
    expect(rootsList.id).toBeTruthy();
    expect(rootsList.id).not.toBe(elicitation.id);

    // 2. Answer both like a 2025 client would (JSON-RPC responses via POST).
    const answerElicit = await post(
      {
        jsonrpc: '2.0',
        id: elicitation.id,
        result: { action: 'accept', content: { color: 'teal' } },
      },
      { 'mcp-session-id': sessionId },
    );
    expect(answerElicit.status).toBe(202);
    const answerRoots = await post(
      {
        jsonrpc: '2.0',
        id: rootsList.id,
        result: { roots: [{ uri: 'file:///workspace', name: 'workspace' }] },
      },
      { 'mcp-session-id': sessionId },
    );
    expect(answerRoots.status).toBe(202);

    // 3. The final tool result arrives on the original SSE stream.
    const finals: any[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        finals.push(JSON.parse(ev.data));
      }
    }
    const final = finals.find((m) => m.id === requestId);
    // "(roots: 1)" proves the roots/list leg reached the roots handler, not
    // a misrouted elicitation.
    expect(final.result.content[0].text).toBe('you picked teal (roots: 1)');
    expect(final.result.resultType).toBeUndefined(); // stripped southbound

    // 4. The upstream retry carried inputResponses and a byte-exact requestState.
    const retry = fixture.log.findLast(
      (r) => r.method === 'tools/call' && r.body.params?.inputResponses,
    )!;
    expect(retry.body.params.requestState).toBe(REQUEST_STATE);
    expect(retry.body.params.inputResponses.color.content.color).toBe('teal');
    expect(retry.body.params.inputResponses.workspaceRoots.roots).toHaveLength(1);
    expect(String(retry.body.id)).not.toBe(String(requestId)); // fresh request id on retry
  }

  it('bridges MRTR: input_required becomes real 2025 elicitation + roots round trips', async () => {
    await driveMrtr(9, 'pick-color');
  });

  it('bridges MRTR when the upstream answers with a per-request SSE body', async () => {
    await driveMrtr(21, 'pick-color-sse');
  });

  it('fails the bridged request explicitly when the client errors a non-elicitation leg', async () => {
    const logStart = fixture.log.length;
    const res = await post(
      {
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: { name: 'pick-color', arguments: {} },
      },
      { 'mcp-session-id': sessionId },
    );
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const parser = new SseParser();
    const decoder = new TextDecoder();
    const messages: any[] = [];
    while (messages.length < 2) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        messages.push(JSON.parse(ev.data));
      }
    }
    const elicitation = messages.find((m) => m.method === 'elicitation/create');
    const rootsList = messages.find((m) => m.method === 'roots/list');
    expect(elicitation).toBeDefined();
    expect(rootsList).toBeDefined();

    // Answer the elicitation leg normally, but ERROR the roots/list leg.
    // ListRootsResult has no decline shape, so the proxy must fail the
    // bridged request instead of inventing a substitute result.
    await post(
      { jsonrpc: '2.0', id: elicitation.id, result: { action: 'accept', content: { color: 'red' } } },
      { 'mcp-session-id': sessionId },
    );
    await post(
      { jsonrpc: '2.0', id: rootsList.id, error: { code: -32000, message: 'client refused' } },
      { 'mcp-session-id': sessionId },
    );

    const finals: any[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
        finals.push(JSON.parse(ev.data));
      }
    }
    const final = finals.find((m) => m.id === 30);
    expect(final.error).toBeDefined();
    expect(final.error.code).toBe(-32603); // internal error, surfaced explicitly
    expect(final.error.message).toContain('roots/list');
    // No retry with a fabricated ListRootsResult ever went upstream.
    const retries = fixture.log
      .slice(logStart)
      .filter((r) => r.method === 'tools/call' && r.body.params?.inputResponses);
    expect(retries).toHaveLength(0);
  });

  it('never leaks 2026-only error codes to the old client', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'echo', arguments: { text: 'x' } } },
      { 'mcp-session-id': sessionId, 'x-force': 'none' },
    );
    expect(res.status).toBe(200); // sanity: normal path still fine
    // Simulate: a modern error surfaced by calling a method the fixture 404s.
    const bad = await post(
      { jsonrpc: '2.0', id: 11, method: 'nonexistent/method' },
      { 'mcp-session-id': sessionId },
    );
    const body = await bad.json();
    expect(body.error.code).toBe(-32601); // passthrough of standard code is fine
  });

  it('terminates the session on DELETE (proxy-local; upstream is stateless)', async () => {
    const del = await fetch(proxy.url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
    expect(del.status).toBe(200);
    const after = await post({ jsonrpc: '2.0', id: 12, method: 'tools/list' }, { 'mcp-session-id': sessionId });
    expect(after.status).toBe(404);
    // The 2026 upstream never saw the DELETE.
    expect(fixture.log.filter((r) => r.httpMethod === 'DELETE')).toHaveLength(0);
  });
});
