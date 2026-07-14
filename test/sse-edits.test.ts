import { describe, expect, it } from 'vitest';
import { serializeSseEvent, SseParser } from '../src/proxy/sse.js';
import { applyEdits } from '../src/core/edits.js';
import { unifiedDiff } from '../src/codemod/diff.js';
import { injectEnvelope, readEnvelope, stripEnvelope, injectModernResultFields, stripModernResultFields } from '../src/proxy/envelope.js';
import type { JsonRpcRequest } from '../src/proxy/jsonrpc.js';

describe('SseParser', () => {
  it('parses events split across arbitrary chunk boundaries', () => {
    const parser = new SseParser();
    const raw = serializeSseEvent({ event: 'message', data: '{"a":1}' });
    const events = [...parser.feed(raw.slice(0, 7)), ...parser.feed(raw.slice(7))];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'message', data: '{"a":1}' });
  });

  it('joins multi-line data fields and ignores comment keep-alives', () => {
    const parser = new SseParser();
    const events = parser.feed(': keep-alive\n\ndata: line1\ndata: line2\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('line1\nline2');
  });

  it('handles CRLF framing and id fields', () => {
    const parser = new SseParser();
    const events = parser.feed('event: message\r\nid: 42\r\ndata: hi\r\n\r\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'message', id: '42', data: 'hi' });
  });
});

describe('applyEdits', () => {
  it('applies non-overlapping edits in offset order', () => {
    const { text, applied } = applyEdits('abcdef', [
      { start: 4, end: 5, text: 'E' },
      { start: 0, end: 1, text: 'A' },
    ]);
    expect(text).toBe('AbcdEf');
    expect(applied).toBe(2);
  });

  it('skips overlapping edits instead of corrupting the file', () => {
    const { text, applied, skipped } = applyEdits('abcdef', [
      { start: 0, end: 4, text: 'X' },
      { start: 2, end: 5, text: 'Y' },
    ]);
    expect(text).toBe('Xef');
    expect(applied).toBe(1);
    expect(skipped).toBe(1);
  });
});

describe('unifiedDiff', () => {
  it('produces hunks with headers for changed lines', () => {
    const before = ['a', 'b', 'c', 'd'].join('\n');
    const after = ['a', 'B', 'c', 'd'].join('\n');
    const diff = unifiedDiff(before, after, 'x.ts');
    expect(diff).toContain('--- a/x.ts');
    expect(diff).toContain('+++ b/x.ts');
    expect(diff).toContain('-b');
    expect(diff).toContain('+B');
    expect(diff).toContain('@@');
  });

  it('returns an empty string for identical inputs', () => {
    expect(unifiedDiff('same', 'same', 'x.ts')).toBe('');
  });
});

describe('envelope helpers', () => {
  const req: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'echo', arguments: { text: 'hi' } },
  };

  it('injects and reads the io.modelcontextprotocol/* identity envelope', () => {
    const stamped = injectEnvelope(req, {
      clientInfo: { name: 'c', version: '1' },
      clientCapabilities: { elicitation: {} },
      logLevel: 'debug',
    }) as JsonRpcRequest;
    const meta = (stamped.params as any)._meta;
    expect(meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(meta['io.modelcontextprotocol/clientInfo']).toEqual({ name: 'c', version: '1' });
    expect(meta['io.modelcontextprotocol/logLevel']).toBe('debug');
    const env = readEnvelope(stamped);
    expect(env.protocolVersion).toBe('2026-07-28');
    expect(env.clientCapabilities).toEqual({ elicitation: {} });
    // Original request must be untouched (no _meta).
    expect((req.params as any)._meta).toBeUndefined();
  });

  it('strips only io.modelcontextprotocol/* keys, preserving foreign _meta', () => {
    const stamped = injectEnvelope(
      { ...req, params: { ...req.params, _meta: { traceparent: '00-abc' } } },
      { clientInfo: { name: 'c' } },
    );
    const stripped = stripEnvelope(stamped) as JsonRpcRequest;
    const meta = (stripped.params as any)._meta;
    expect(meta).toEqual({ traceparent: '00-abc' });
  });

  it('removes _meta entirely when the envelope was its only content', () => {
    const stamped = injectEnvelope(req, { clientInfo: { name: 'c' } });
    const stripped = stripEnvelope(stamped) as JsonRpcRequest;
    expect((stripped.params as any)._meta).toBeUndefined();
    expect((stripped.params as any).name).toBe('echo');
  });

  it('injects resultType/ttlMs/cacheScope for cacheable methods and strips them symmetrically', () => {
    const legacyResult = { tools: [{ name: 'echo' }] };
    const upgraded = injectModernResultFields(legacyResult, 'tools/list');
    expect(upgraded).toMatchObject({ resultType: 'complete', ttlMs: 0, cacheScope: 'private' });
    const plain = injectModernResultFields({ content: [] }, 'tools/call');
    expect(plain.resultType).toBe('complete');
    expect(plain.ttlMs).toBeUndefined();
    const downgraded = stripModernResultFields(upgraded);
    expect(downgraded).toEqual(legacyResult);
  });
});
