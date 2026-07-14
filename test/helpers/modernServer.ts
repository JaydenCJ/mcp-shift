/**
 * Minimal 2026-07-28 (RC) MCP server fixture: POST-only, header validation,
 * per-request _meta envelope, server/discover, CacheableResult fields,
 * resultType on every result, and one MRTR (input_required) tool.
 * Records everything it receives for assertions.
 */
import http from 'node:http';

export interface RecordedRequest {
  method: string;
  httpMethod: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

export interface ModernServerFixture {
  url: string;
  log: RecordedRequest[];
  close(): Promise<void>;
}

const VERSION = '2026-07-28';
const REQUEST_STATE = 'mrtr-state-7f3a:round1';

export async function startModernServer(): Promise<ModernServerFixture> {
  const log: RecordedRequest[] = [];

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

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // SEP-2567/2575: GET stream and DELETE termination are gone.
      if (req.method === 'GET' || req.method === 'DELETE') {
        res.writeHead(405, { allow: 'POST' });
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        res.end();
        return;
      }

      const id = body?.id ?? null;
      const isNotification = body && typeof body.method === 'string' && !('id' in body);

      // Version gate: unsupported/missing version → 400 + -32022 with `supported`.
      // (This is also what makes a legacy `initialize` probe recognizable.)
      const headerVersion = req.headers['mcp-protocol-version'];
      if (headerVersion !== VERSION || body?.method === 'initialize') {
        json(400, {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32022,
            message: `Unsupported protocol version`,
            data: { supported: [VERSION], requested: headerVersion ?? null },
          },
        });
        return;
      }
      // Mcp-Method must mirror the body method on requests (not notifications).
      if (!isNotification && req.headers['mcp-method'] !== body?.method) {
        json(400, {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32020,
            message: 'Mcp-Method header does not match body',
            data: { header: req.headers['mcp-method'] ?? null, body: body?.method },
          },
        });
        return;
      }

      if (isNotification) {
        res.writeHead(202);
        res.end();
        return;
      }

      switch (body?.method) {
        case 'server/discover':
          json(200, {
            jsonrpc: '2.0',
            id,
            result: {
              resultType: 'complete',
              supportedVersions: [VERSION],
              serverInfo: { name: 'modern-fixture', version: '1.0.0' },
              capabilities: { tools: { listChanged: true } },
              ttlMs: 60000,
              cacheScope: 'public',
            },
          });
          return;
        case 'tools/list':
          json(200, {
            jsonrpc: '2.0',
            id,
            result: {
              resultType: 'complete',
              ttlMs: 60000,
              cacheScope: 'public',
              // Deterministic order (list results no longer vary per connection).
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
                {
                  name: 'greet',
                  description: 'Greet a tenant (tenant is mirrored into an HTTP header)',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      tenant: { type: 'string', 'x-mcp-header': true },
                    },
                    required: ['name', 'tenant'],
                  },
                },
                {
                  name: 'pick-color',
                  description: 'Asks the user to pick a color (MRTR demo)',
                  inputSchema: { type: 'object', properties: {} },
                },
              ],
            },
          });
          return;
        case 'tools/call': {
          const name = body.params?.name;
          const args = body.params?.arguments ?? {};
          if (name === 'echo') {
            json(200, {
              jsonrpc: '2.0',
              id,
              result: {
                resultType: 'complete',
                content: [{ type: 'text', text: `modern-echo:${args.text ?? ''}` }],
              },
            });
            return;
          }
          if (name === 'greet') {
            json(200, {
              jsonrpc: '2.0',
              id,
              result: {
                resultType: 'complete',
                content: [{ type: 'text', text: `hello ${args.name} @ ${args.tenant}` }],
              },
            });
            return;
          }
          if (name === 'pick-color' || name === 'pick-color-sse') {
            const responses = body.params?.inputResponses;
            if (!responses) {
              // MRTR round 1: ask the client for input (SEP-2322). Entries
              // are JSON-RPC request objects per InputRequests in
              // schema/draft/schema.json — no 'type' discriminator.
              const response = {
                jsonrpc: '2.0',
                id,
                result: {
                  resultType: 'input_required',
                  inputRequests: {
                    color: {
                      method: 'elicitation/create',
                      params: {
                        message: 'Pick a color',
                        requestedSchema: {
                          type: 'object',
                          properties: { color: { type: 'string' } },
                          required: ['color'],
                        },
                      },
                    },
                    // A second, non-elicitation leg: proves the proxy routes
                    // by the spec `method` member instead of defaulting
                    // everything to elicitation/create.
                    workspaceRoots: { method: 'roots/list' },
                  },
                  requestState: REQUEST_STATE,
                },
              };
              if (name === 'pick-color-sse') {
                // The 2026 transport allows answering any request with a
                // per-request SSE body instead of JSON.
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
                return;
              }
              json(200, response);
              return;
            }
            // MRTR round 2: requestState must be echoed byte-exactly.
            if (body.params?.requestState !== REQUEST_STATE) {
              json(200, {
                jsonrpc: '2.0',
                id,
                error: { code: -32602, message: 'requestState mismatch' },
              });
              return;
            }
            const color = responses.color?.content?.color ?? '(none)';
            const roots = Array.isArray(responses.workspaceRoots?.roots)
              ? responses.workspaceRoots.roots.length
              : 'missing';
            json(200, {
              jsonrpc: '2.0',
              id,
              result: {
                resultType: 'complete',
                content: [{ type: 'text', text: `you picked ${color} (roots: ${roots})` }],
              },
            });
            return;
          }
          json(200, {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown tool: ${name}` },
          });
          return;
        }
        case 'resources/read':
          // 2026-era: resource not found is -32602 (was -32002).
          json(200, {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Resource not found: ${body.params?.uri}` },
          });
          return;
        default:
          // Unknown RPC method → HTTP 404 + -32601 (removed methods land here too).
          json(404, {
            jsonrpc: '2.0',
            id,
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export { REQUEST_STATE };
