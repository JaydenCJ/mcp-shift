import { describe, expect, it } from 'vitest';
import { lintText } from '../src/lint/linter.js';

const HEADER = `import { Server } from '@modelcontextprotocol/server';\n`;
const lint = (code: string, specVersion?: '2026-07-28' | '2025-11-25') =>
  lintText('file.ts', code, specVersion ? { specVersion } : {});

describe('2026-removed-method', () => {
  it('flags initialize/ping/logging-setLevel handlers as removed', () => {
    const code =
      HEADER +
      `server.setRequestHandler('initialize', h1);\n` +
      `server.setRequestHandler('ping', h2);\n` +
      `client.request({ method: 'logging/setLevel', params: { level: 'debug' } });\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-removed-method');
    expect(findings).toHaveLength(3);
    expect(findings[0]!.message).toContain('server/discover');
    expect(findings[2]!.message).toContain('io.modelcontextprotocol/logLevel');
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('flags resources/subscribe with subscriptions/listen guidance', () => {
    const code = HEADER + `await client.request({ method: 'resources/subscribe', params: { uri } });\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-removed-method');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('subscriptions/listen');
  });

  it('marks deprecated (not removed) methods as warnings', () => {
    const code = HEADER + `await extra.sendRequest({ method: 'sampling/createMessage', params });\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-removed-method');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });

  it('ignores the same strings outside method positions', () => {
    const code = HEADER + `const doc = 'how to initialize: call ping';\nconsole.log('ping');\n`;
    expect(lint(code).filter((f) => f.ruleId === '2026-removed-method')).toHaveLength(0);
  });

  it('is silenced entirely when targeting 2025-11-25', () => {
    const code = HEADER + `server.setRequestHandler('ping', h);\n`;
    expect(lint(code, '2025-11-25').filter((f) => f.tier === '2026')).toHaveLength(0);
  });
});

describe('2026-session-usage', () => {
  it('flags ctx.sessionId, sessionIdGenerator and Mcp-Session-Id literals', () => {
    const code =
      HEADER +
      `const t = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => id() });\n` +
      `const sid = ctx.sessionId;\n` +
      `req.headers['mcp-session-id'];\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-session-usage');
    expect(findings).toHaveLength(3);
    expect(findings.some((f) => f.message.includes('requestState'))).toBe(true);
  });
});

describe('2026-deprecated-capability', () => {
  it('flags sampling/roots/logging/elicitation convenience APIs', () => {
    const code =
      HEADER +
      `await server.createMessage(params);\n` +
      `await server.listRoots();\n` +
      `await ctx.mcpReq.elicitInput({ message: 'hi' });\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-deprecated-capability');
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.severity)).toEqual(['warn', 'warn', 'warn']);
    expect(findings[2]!.message).toContain('inputRequired');
  });
});

describe('2026-error-code-literal', () => {
  it('flags renumbered draft-era codes and the -32002 resource-not-found move', () => {
    const code =
      HEADER +
      `if (err.code === -32002) handleMissing();\n` +
      `throw makeError(-32001, 'header mismatch');\n` +
      `const x = -32004;\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-error-code-literal');
    expect(findings).toHaveLength(3);
    expect(findings[0]!.message).toContain('-32602');
    expect(findings[1]!.message).toContain('-32020');
    expect(findings[2]!.message).toContain('-32022');
  });

  it('does not flag unrelated negative numbers', () => {
    const code = `const t = -32000 - 1 - -42;\n`;
    expect(lint(code).filter((f) => f.ruleId === '2026-error-code-literal')).toHaveLength(0);
  });
});

describe('v2-tasks-removed', () => {
  it('flags the removed experimental tasks surface', () => {
    const code =
      HEADER +
      `const server = new McpServer(info, { taskStore: new InMemoryTaskStore() });\n` +
      `server.registerToolTask('t', cfg, handler);\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-tasks-removed');
    expect(findings.length).toBeGreaterThanOrEqual(3); // taskStore, InMemoryTaskStore, registerToolTask
    expect(findings[0]!.message).toContain('io.modelcontextprotocol/tasks');
  });
});

describe('2026-result-type-read', () => {
  it('warns when application code reads result.resultType', () => {
    const code = HEADER + `if (result.resultType === 'complete') {}\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-result-type-read');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warn');
  });
});

describe('2026-x-mcp-header-type', () => {
  it("rejects x-mcp-header parameters typed 'number' (primitives only, number excluded)", () => {
    const code =
      HEADER +
      `const schema = { type: 'object', properties: { port: { type: 'number', 'x-mcp-header': true } } };\n`;
    const findings = lint(code).filter((f) => f.ruleId === '2026-x-mcp-header-type');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
  });

  it('accepts string/boolean/integer x-mcp-header parameters', () => {
    const code =
      HEADER +
      `const schema = { properties: { tenant: { type: 'string', 'x-mcp-header': true }, n: { type: 'integer', 'x-mcp-header': 'Tenant-Id' } } };\n`;
    expect(lint(code).filter((f) => f.ruleId === '2026-x-mcp-header-type')).toHaveLength(0);
  });
});
