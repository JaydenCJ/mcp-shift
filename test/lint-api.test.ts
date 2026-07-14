import { describe, expect, it } from 'vitest';
import { lintText } from '../src/lint/linter.js';
import { codemodText } from '../src/codemod/codemod.js';

const HEADER = `import { McpServer } from '@modelcontextprotocol/server';\nimport { z } from 'zod';\n`;

const fix = (code: string) => codemodText('file.ts', code).after;
const lint = (code: string) => lintText('file.ts', code);

describe('v2-variadic-registration', () => {
  it('rewrites server.tool(name, desc, shape, cb) wrapping the raw shape in z.object', () => {
    const code =
      HEADER +
      `server.tool('add', 'Add numbers', { a: z.number(), b: z.number() }, async ({ a, b }) => ({ content: [] }));\n`;
    const after = fix(code);
    expect(after).toContain(
      `server.registerTool('add', { description: 'Add numbers', inputSchema: z.object({ a: z.number(), b: z.number() }) }, async ({ a, b }) => ({ content: [] }));`,
    );
  });

  it('rewrites server.tool(name, cb) with an empty config object', () => {
    const code = HEADER + `server.tool('noop', () => ({ content: [] }));\n`;
    expect(fix(code)).toContain(`server.registerTool('noop', {}, () => ({ content: [] }));`);
  });

  it('passes existing z.object schemas through unwrapped', () => {
    const code = HEADER + `server.tool('t', z.object({ q: z.string() }), cb);\n`;
    const after = fix(code);
    expect(after).toContain(`inputSchema: z.object({ q: z.string() })`);
    expect(after).not.toContain('z.object(z.object');
  });

  it('rewrites server.prompt() with argsSchema and server.resource() with required metadata', () => {
    const code =
      HEADER +
      `server.prompt('p', 'A prompt', { topic: z.string() }, cb);\n` +
      `server.resource('r', 'file:///x.txt', cb);\n`;
    const after = fix(code);
    expect(after).toContain(`server.registerPrompt('p', { description: 'A prompt', argsSchema: z.object({ topic: z.string() }) }, cb);`);
    expect(after).toContain(`server.registerResource('r', 'file:///x.txt', {}, cb);`);
  });

  it('flags unrecognized resource overloads for manual migration', () => {
    const code = HEADER + `server.resource('r', template, meta, extraArg, cb);\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-variadic-registration');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fix).toBeUndefined();
  });
});

describe('v2-schema-request-handler', () => {
  it('replaces known request schemas with method strings', () => {
    const code =
      HEADER +
      `server.setRequestHandler(CallToolRequestSchema, handler);\n` +
      `server.setRequestHandler(ListToolsRequestSchema, handler2);\n`;
    const after = fix(code);
    expect(after).toContain(`server.setRequestHandler('tools/call', handler);`);
    expect(after).toContain(`server.setRequestHandler('tools/list', handler2);`);
  });

  it('replaces notification schemas on setNotificationHandler', () => {
    const code = HEADER + `server.setNotificationHandler(CancelledNotificationSchema, onCancel);\n`;
    expect(fix(code)).toContain(`server.setNotificationHandler('notifications/cancelled', onCancel);`);
  });

  it('flags task schemas as removed (SEP-2663) without a fix', () => {
    const code = HEADER + `server.setRequestHandler(GetTaskRequestSchema, h);\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-schema-request-handler');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.fix).toBeUndefined();
    expect(findings[0]!.message).toContain('SEP-2663');
  });

  it('flags unknown custom schemas pointing at the 3-arg form', () => {
    const code = HEADER + `server.setRequestHandler(MyCustomRequestSchema, h);\n`;
    const findings = lint(code).filter((f) => f.ruleId === 'v2-schema-request-handler');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('3-arg');
  });
});

describe('v2-handler-context', () => {
  it('renames extra to ctx and remaps properties onto mcpReq/http', () => {
    const code =
      HEADER +
      `server.setRequestHandler('tools/call', async (req, extra) => {\n` +
      `  extra.signal.throwIfAborted();\n` +
      `  log(extra.requestId, extra.sessionId);\n` +
      `  await extra.sendNotification(n);\n` +
      `  const auth = extra.authInfo;\n` +
      `  extra.closeSSEStream();\n` +
      `  return { content: [] };\n` +
      `});\n`;
    const after = fix(code);
    expect(after).toContain(`async (req, ctx) =>`);
    expect(after).toContain(`ctx.mcpReq.signal.throwIfAborted();`);
    expect(after).toContain(`log(ctx.mcpReq.id, ctx.sessionId);`);
    expect(after).toContain(`await ctx.mcpReq.notify(n);`);
    expect(after).toContain(`const auth = ctx.http?.authInfo;`);
    expect(after).toContain(`ctx.http?.closeSSE?.();`);
  });

  it('leaves unrelated identifiers called extra alone when not a parameter', () => {
    const code = `const extra = 1;\nconsole.log(extra);\n`;
    expect(lint(code).filter((f) => f.ruleId === 'v2-handler-context')).toHaveLength(0);
  });
});

describe('v2-result-schema-arg', () => {
  it('drops spec result schemas from client.request and callTool', () => {
    const code =
      HEADER +
      `const r = await client.request({ method: 'tools/list' }, ListToolsResultSchema);\n` +
      `const c = await client.callTool({ name: 'echo' }, CallToolResultSchema);\n`;
    const after = fix(code);
    expect(after).toContain(`client.request({ method: 'tools/list' });`);
    expect(after).toContain(`client.callTool({ name: 'echo' });`);
  });

  it('keeps non-spec schemas (schema-less non-spec calls throw TypeError in v2)', () => {
    const code = HEADER + `await client.request({ method: 'x/custom' }, MyCustomResultSchema);\n`;
    expect(fix(code)).toContain('MyCustomResultSchema');
    expect(lint(code).filter((f) => f.ruleId === 'v2-result-schema-arg')).toHaveLength(0);
  });
});

describe('v2-completable-order', () => {
  it('inverts completable(schema.optional(), cb) to completable(schema, cb).optional()', () => {
    const code = HEADER + `const c = completable(z.string().optional(), complete);\n`;
    expect(fix(code)).toContain(`completable(z.string(), complete).optional()`);
  });

  it('does not touch already-correct completable calls', () => {
    const code = HEADER + `const c = completable(z.string(), complete).optional();\n`;
    expect(lint(code).filter((f) => f.ruleId === 'v2-completable-order')).toHaveLength(0);
  });
});
