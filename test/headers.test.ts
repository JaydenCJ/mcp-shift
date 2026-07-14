import { describe, expect, it } from 'vitest';
import { decodeHeaderValue, encodeHeaderValue, isHeaderSafe, mcpNameParam } from '../src/proxy/headers.js';

describe('Mcp-Name Base64 sentinel encoding', () => {
  it('passes header-safe values through unchanged', () => {
    expect(encodeHeaderValue('echo')).toBe('echo');
    expect(encodeHeaderValue('file:///x/y.txt')).toBe('file:///x/y.txt');
  });

  it('sentinel-encodes non-ASCII values and round-trips them', () => {
    const name = 'ツール/検索';
    const encoded = encodeHeaderValue(name);
    expect(encoded.startsWith('=?base64?')).toBe(true);
    expect(encoded.endsWith('?=')).toBe(true);
    expect(decodeHeaderValue(encoded)).toBe(name);
  });

  it('sentinel-encodes values with leading/trailing whitespace and control chars', () => {
    for (const v of [' padded ', 'line\nbreak', 'tab\tchar', '']) {
      const encoded = encodeHeaderValue(v);
      expect(decodeHeaderValue(encoded)).toBe(v);
      if (v !== '') expect(isHeaderSafe(v)).toBe(false);
    }
  });

  it('encodes values that could be mistaken for a sentinel', () => {
    const tricky = '=?base64?Zm9v?=';
    const encoded = encodeHeaderValue(tricky);
    expect(encoded).not.toBe(tricky);
    expect(decodeHeaderValue(encoded)).toBe(tricky);
  });

  it('leaves non-sentinel values untouched on decode', () => {
    expect(decodeHeaderValue('plain-value')).toBe('plain-value');
  });

  it('knows which methods require Mcp-Name and from which param', () => {
    expect(mcpNameParam('tools/call')).toBe('name');
    expect(mcpNameParam('prompts/get')).toBe('name');
    expect(mcpNameParam('resources/read')).toBe('uri');
    expect(mcpNameParam('tools/list')).toBeUndefined();
  });
});
