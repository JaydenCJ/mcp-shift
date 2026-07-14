/**
 * A deliberately outdated MCP server written against SDK v1 and the 2025-era
 * protocol. Run `mcp-shift lint examples/v1-server` to see every problem, and
 * `mcp-shift codemod examples/v1-server` to see the mechanical rewrite.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const server = new McpServer({ name: 'weather', version: '1.0.0' });

// v1 variadic registration with a raw Zod shape.
server.tool(
  'get-forecast',
  'Get the forecast for a city',
  { city: z.string(), days: z.number() },
  async ({ city, days }, extra) => {
    extra.signal.throwIfAborted();
    console.error('request', extra.requestId, 'session', extra.sessionId);
    return { content: [{ type: 'text', text: `Forecast for ${city} (${days}d)` }] };
  },
);

// v1 schema-first handler registration.
server.server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [] };
});

server.server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  if (req.params.name !== 'get-forecast') {
    // 2025-era resource-not-found convention.
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${req.params.name}`);
  }
  await extra.sendNotification({ method: 'notifications/progress', params: { progress: 1 } });
  return { content: [] };
});

// Session-managed 2025-era HTTP hosting (removed in 2026-07-28).
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);
