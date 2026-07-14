#!/usr/bin/env node
/**
 * A tiny standalone MCP server speaking the 2026-07-28 revision (RC):
 * POST-only, header-validated, stateless, `server/discover`, deterministic
 * tools/list with cache hints, resultType on every result, and one MRTR
 * (input_required) tool. Used by examples/demo.sh.
 *
 *   node examples/modern-server.mjs [port]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 3000);
const VERSION = '2026-07-28';
const REQUEST_STATE = 'demo-state-0001';

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const json = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    // SEP-2567/2575: no GET stream, no DELETE termination — POST only.
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }
    const id = body?.id ?? null;
    if (req.headers['mcp-protocol-version'] !== VERSION) {
      json(400, {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32022,
          message: 'Unsupported protocol version',
          data: { supported: [VERSION], requested: req.headers['mcp-protocol-version'] ?? null },
        },
      });
      return;
    }
    const isNotification = body && typeof body.method === 'string' && !('id' in body);
    if (isNotification) {
      res.writeHead(202);
      res.end();
      return;
    }
    if (req.headers['mcp-method'] !== body?.method) {
      json(400, {
        jsonrpc: '2.0',
        id,
        error: { code: -32020, message: 'Mcp-Method header does not match body' },
      });
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
            serverInfo: { name: 'demo-modern-server', version: '1.0.0' },
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
              content: [{ type: 'text', text: `echo: ${args.text ?? ''}` }],
            },
          });
          return;
        }
        if (name === 'pick-color') {
          if (!body.params?.inputResponses) {
            json(200, {
              jsonrpc: '2.0',
              id,
              result: {
                resultType: 'input_required',
                // InputRequests entries are JSON-RPC request objects
                // ({ method, params }) per schema/draft/schema.json.
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
                },
                requestState: REQUEST_STATE,
              },
            });
            return;
          }
          if (body.params.requestState !== REQUEST_STATE) {
            json(200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'requestState mismatch' } });
            return;
          }
          const color = body.params.inputResponses.color?.content?.color ?? '(none)';
          json(200, {
            jsonrpc: '2.0',
            id,
            result: { resultType: 'complete', content: [{ type: 'text', text: `you picked ${color}` }] },
          });
          return;
        }
        json(200, { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
        return;
      }
      default:
        json(404, { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${body?.method}` } });
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`[demo-modern-server] 2026-07-28 (stateless) server on http://127.0.0.1:${PORT}/`);
});
