/**
 * Minimal 2025-era (protocol 2025-11-25) MCP server fixture: initialize
 * handshake, Mcp-Session-Id enforcement, JSON responses. Records everything
 * it receives so tests can assert on what the proxy sent northbound.
 */
import http from 'node:http';

export interface RecordedRequest {
  method: string;
  httpMethod: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

export interface LegacyServerFixture {
  url: string;
  log: RecordedRequest[];
  setLevelCalls: string[];
  close(): Promise<void>;
}

const SESSION_ID = 'legacy-fixture-session-1';

export async function startLegacyServer(): Promise<LegacyServerFixture> {
  const log: RecordedRequest[] = [];
  const setLevelCalls: string[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body: any;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      log.push({
        method: body?.method ?? '(none)',
        httpMethod: req.method ?? '',
        headers: { ...req.headers },
        body,
      });

      const json = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        const data = JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(data);
      };

      if (req.method === 'DELETE') {
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        json(405, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'POST only fixture' } });
        return;
      }
      if (body?.method === 'initialize') {
        json(
          200,
          {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: body.params?.protocolVersion ?? '2025-11-25',
              capabilities: { tools: { listChanged: true }, logging: {} },
              serverInfo: { name: 'legacy-fixture', version: '1.0.0' },
            },
          },
          { 'mcp-session-id': SESSION_ID },
        );
        return;
      }
      // All non-initialize traffic requires the session header.
      if (req.headers['mcp-session-id'] !== SESSION_ID) {
        json(400, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32000, message: 'Missing session' } });
        return;
      }
      if (body?.method === 'notifications/initialized' || body?.method === 'notifications/cancelled') {
        res.writeHead(202);
        res.end();
        return;
      }
      switch (body?.method) {
        case 'ping':
          json(200, { jsonrpc: '2.0', id: body.id, result: {} });
          return;
        case 'logging/setLevel':
          setLevelCalls.push(String(body.params?.level));
          json(200, { jsonrpc: '2.0', id: body.id, result: {} });
          return;
        case 'tools/list':
          json(200, {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo text back',
                  inputSchema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text'],
                  },
                },
              ],
            },
          });
          return;
        case 'tools/call': {
          const args = body.params?.arguments ?? {};
          json(200, {
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: `legacy-echo:${args.text ?? ''}` }] },
          });
          return;
        }
        case 'resources/read':
          // 2025-era resource-not-found code.
          json(200, {
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32002, message: `Resource not found: ${body.params?.uri}` },
          });
          return;
        default:
          json(200, {
            jsonrpc: '2.0',
            id: body?.id ?? null,
            error: { code: -32601, message: `Method not found: ${body?.method}` },
          });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    log,
    setLevelCalls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
