import { describe, expect, it } from 'vitest';
import { lintText } from '../src/lint/linter.js';
import { codemodText } from '../src/codemod/codemod.js';

const lint = (code: string) => lintText('file.ts', code);
const fix = (code: string) => codemodText('file.ts', code).after;

describe('v2-import-path', () => {
  it('rewrites the client barrel import', () => {
    const code = `import { Client } from '@modelcontextprotocol/sdk/client/index.js';\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-import-path');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fix).toBeDefined();
    expect(fix(code)).toBe(`import { Client } from '@modelcontextprotocol/client';\n`);
  });

  it('rewrites server/mcp.js and preserves double quotes', () => {
    const code = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\n`;
    expect(fix(code)).toBe(`import { McpServer } from "@modelcontextprotocol/server";\n`);
  });

  it('maps stdio transports to package subpaths (not the root barrel)', () => {
    const code = [
      `import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';`,
      `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';`,
    ].join('\n');
    const after = fix(code);
    expect(after).toContain(`'@modelcontextprotocol/client/stdio'`);
    expect(after).toContain(`'@modelcontextprotocol/server/stdio'`);
  });

  it('maps types.js to @modelcontextprotocol/core', () => {
    const code = `import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';\n`;
    expect(fix(code)).toContain(`'@modelcontextprotocol/core'`);
  });

  it('flags removed SSE/WebSocket transports without a mechanical fix', () => {
    const code = [
      `import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';`,
      `import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';`,
    ].join('\n');
    const findings = lint(code).filter((f) => f.ruleId === 'v2-import-path');
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.fix).toBeUndefined();
      expect(f.severity).toBe('error');
    }
    expect(findings[0]!.message).toContain('server-legacy/sse');
    expect(findings[1]!.message).toContain('StreamableHTTPClientTransport');
    expect(fix(code)).toBe(code); // untouched
  });

  it('flags Protocol/mergeCapabilities imports as manual with fallbackRequestHandler guidance', () => {
    const code = `import { Protocol, mergeCapabilities } from '@modelcontextprotocol/sdk/shared/protocol.js';\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-import-path');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('fallbackRequestHandler');
    expect(findings[0]!.fix).toBeUndefined();
  });

  it('rewrites require(), dynamic import() and vi.mock() specifiers', () => {
    const code = [
      `const sdk = require('@modelcontextprotocol/sdk/server/mcp.js');`,
      `const types = await import('@modelcontextprotocol/sdk/types.js');`,
      `vi.mock('@modelcontextprotocol/sdk/client/index.js');`,
    ].join('\n');
    const after = fix(code);
    expect(after).toContain(`require('@modelcontextprotocol/server')`);
    expect(after).toContain(`import('@modelcontextprotocol/core')`);
    expect(after).toContain(`vi.mock('@modelcontextprotocol/client')`);
  });

  it('handles specifiers without the .js suffix', () => {
    const code = `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';\n`;
    expect(fix(code)).toBe(`import { McpServer } from '@modelcontextprotocol/server';\n`);
  });

  it('does not flag the v2 split packages', () => {
    const code = `import { McpServer } from '@modelcontextprotocol/server';\n`;
    expect(lint(code).filter((f) => f.ruleId === 'v2-import-path')).toHaveLength(0);
  });
});

describe('v2-unused-schema-import', () => {
  it('removes schema imports left dead by the method-string rewrite (multi-pass)', () => {
    const code =
      `import { CallToolRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';\n` +
      `server.setRequestHandler(CallToolRequestSchema, async () => { throw new McpError(1, 'x'); });\n`;
    const after = fix(code);
    expect(after).toContain(`setRequestHandler('tools/call'`);
    expect(after).not.toContain('CallToolRequestSchema');
    expect(after).toContain(`import { ProtocolError } from '@modelcontextprotocol/core';`);
  });

  it('keeps schema imports that are still referenced', () => {
    const code =
      `import { CallToolRequestSchema } from '@modelcontextprotocol/core';\n` +
      `validate(CallToolRequestSchema, payload);\n`;
    expect(lint(code).filter((f) => f.ruleId === 'v2-unused-schema-import')).toHaveLength(0);
    expect(fix(code)).toBe(code);
  });

  it('removes the whole declaration when every named import is a dead schema', () => {
    const code =
      `import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/core';\n` +
      `server.setRequestHandler('tools/list', async () => ({ tools: [] }));\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-unused-schema-import');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
    expect(fix(code)).toBe(`server.setRequestHandler('tools/list', async () => ({ tools: [] }));\n`);
  });

  it('removes a trailing dead specifier while keeping live ones', () => {
    const code =
      `import { ProtocolError, ListToolsRequestSchema } from '@modelcontextprotocol/core';\n` +
      `throw new ProtocolError(1, 'x');\n`;
    expect(fix(code)).toBe(
      `import { ProtocolError } from '@modelcontextprotocol/core';\n` +
        `throw new ProtocolError(1, 'x');\n`,
    );
  });

  it('leaves aliased schema imports alone when the alias is used', () => {
    const code =
      `import { CallToolRequestSchema as CallSchema } from '@modelcontextprotocol/core';\n` +
      `validate(CallSchema);\n`;
    expect(fix(code)).toBe(code);
  });

  it('does not touch non-schema unused imports (out of scope for this rule)', () => {
    const code = `import { ProtocolError } from '@modelcontextprotocol/core';\nexport {};\n`;
    expect(lint(code).filter((f) => f.ruleId === 'v2-unused-schema-import')).toHaveLength(0);
  });
});
