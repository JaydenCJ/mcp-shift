import type http from 'node:http';
import type { JsonRpcMessage } from './jsonrpc.js';

export async function readBody(req: http.IncomingMessage, limit = 8 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
    ...headers,
  });
  res.end(payload);
}

export function sendEmpty(res: http.ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, headers);
  res.end();
}

export function startSse(res: http.ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // 2026-07-28 transport guidance: disable proxy buffering on SSE responses.
    'x-accel-buffering': 'no',
    ...headers,
  });
  res.flushHeaders?.();
}

export interface UpstreamJsonResult {
  kind: 'json';
  status: number;
  message: JsonRpcMessage | undefined;
  headers: Headers;
}

export interface UpstreamSseResult {
  kind: 'sse';
  status: number;
  body: ReadableStream<Uint8Array>;
  headers: Headers;
}

export interface UpstreamEmptyResult {
  kind: 'empty';
  status: number;
  headers: Headers;
}

export type UpstreamResult = UpstreamJsonResult | UpstreamSseResult | UpstreamEmptyResult;

/** POST a JSON-RPC message upstream and classify the response. */
export async function postUpstream(
  url: string,
  message: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<UpstreamResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(message),
    ...(signal ? { signal } : {}),
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') && res.body) {
    return { kind: 'sse', status: res.status, body: res.body, headers: res.headers };
  }
  const text = await res.text();
  if (text.trim().length === 0) {
    return { kind: 'empty', status: res.status, headers: res.headers };
  }
  let message2: JsonRpcMessage | undefined;
  try {
    message2 = JSON.parse(text) as JsonRpcMessage;
  } catch {
    message2 = undefined;
  }
  return { kind: 'json', status: res.status, message: message2, headers: res.headers };
}
