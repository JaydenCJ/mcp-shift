import { describe, expect, it } from 'vitest';
import { lintText } from '../src/lint/linter.js';
import { codemodText } from '../src/codemod/codemod.js';

const HEADER = `import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';\n`;

const fix = (code: string) => codemodText('file.ts', code).after;
const lint = (code: string) => lintText('file.ts', code);

describe('v2-renamed-symbol', () => {
  it('renames McpError and ErrorCode across the file (imports and uses)', () => {
    const code = HEADER + `throw new McpError(ErrorCode.InvalidParams, 'nope');\n`;
    const after = fix(code);
    expect(after).toContain(`import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/core';`);
    expect(after).toContain(`throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'nope');`);
  });

  it('special-cases ErrorCode.RequestTimeout/ConnectionClosed to SdkErrorCode', () => {
    const code = HEADER + `if (e.code === ErrorCode.RequestTimeout || e.code === ErrorCode.ConnectionClosed) retry();\n`;
    const after = fix(code);
    expect(after).toContain('SdkErrorCode.RequestTimeout');
    expect(after).toContain('SdkErrorCode.ConnectionClosed');
    expect(after).not.toContain('ProtocolErrorCode.RequestTimeout');
  });

  it('renames StreamableHTTPServerTransport and warns on StreamableHTTPError constructor calls', () => {
    const code =
      `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';\n` +
      `import { StreamableHTTPError } from '@modelcontextprotocol/sdk/types.js';\n` +
      `const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });\n` +
      `throw new StreamableHTTPError(401, 'no');\n`;
    const after = fix(code);
    expect(after).toContain(`import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';`);
    expect(after).toContain('new NodeStreamableHTTPServerTransport(');
    expect(after).toContain('new SdkHttpError(401');
    const warns = lint(code).filter((f) => f.severity === 'warn' && f.message.includes('Constructor signature changed'));
    expect(warns).toHaveLength(1);
  });

  it('renames the JSON-RPC response family preserving v1 result-only semantics', () => {
    const code =
      `import { isJSONRPCResponse, JSONRPCError } from '@modelcontextprotocol/sdk/types.js';\n` +
      `if (isJSONRPCResponse(m)) {}\n` +
      `const e: JSONRPCError = x;\n`;
    const after = fix(code);
    expect(after).toContain('isJSONRPCResultResponse(m)');
    expect(after).toContain('JSONRPCErrorResponse');
  });

  it('drops the IsomorphicHeaders import and renames references to global Headers', () => {
    const code =
      `import { IsomorphicHeaders, McpError } from '@modelcontextprotocol/sdk/types.js';\n` +
      `function f(h: IsomorphicHeaders) {}\n`;
    const after = fix(code);
    expect(after).toContain(`import { ProtocolError } from '@modelcontextprotocol/core';`);
    expect(after).toContain('function f(h: Headers)');
    expect(after).not.toContain('IsomorphicHeaders');
  });

  it('rewrites RequestHandlerExtra<A, B> dropping type arguments', () => {
    const code =
      `import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';\n` +
      `function g(extra: RequestHandlerExtra<ServerRequest, ServerNotification>) {}\n`;
    const after = fix(code);
    expect(after).toContain('ServerContext)');
    expect(after).not.toContain('RequestHandlerExtra<');
  });

  it('does not rename symbols in files that never touch the SDK', () => {
    const code = `const McpError = 1;\nexport { McpError };\n`;
    expect(lint(code).filter((f) => f.ruleId === 'v2-renamed-symbol')).toHaveLength(0);
  });
});
