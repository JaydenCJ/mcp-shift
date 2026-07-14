import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderDiffs, runCodemod, codemodText } from '../src/codemod/codemod.js';
import { lintPaths } from '../src/lint/linter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.join(here, '..', 'examples', 'v1-server');

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-shift-test-'));
  fs.cpSync(exampleDir, tmp, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runCodemod on the example v1 server project', () => {
  it('dry-run leaves files untouched and renders a unified diff', () => {
    const before = fs.readFileSync(path.join(tmp, 'src', 'server.ts'), 'utf8');
    const run = runCodemod([tmp], {});
    expect(fs.readFileSync(path.join(tmp, 'src', 'server.ts'), 'utf8')).toBe(before);
    expect(run.changedFiles).toBeGreaterThanOrEqual(2); // server.ts + package.json
    const diff = renderDiffs(run, tmp);
    expect(diff).toContain('--- a/');
    expect(diff).toContain("+import { McpServer } from '@modelcontextprotocol/server';");
  });

  it('--write applies the full v1→v2 migration to the source file', () => {
    runCodemod([tmp], { write: true });
    const after = fs.readFileSync(path.join(tmp, 'src', 'server.ts'), 'utf8');
    // Imports moved to split packages.
    expect(after).toContain(`import { McpServer } from '@modelcontextprotocol/server';`);
    expect(after).toContain(`from '@modelcontextprotocol/node';`);
    expect(after).toContain(`from '@modelcontextprotocol/core';`);
    // Variadic tool registration became registerTool with z.object.
    expect(after).toContain(`server.registerTool(`);
    expect(after).toContain(`inputSchema: z.object({ city: z.string(), days: z.number() })`);
    // Schema handlers became method strings, and the now-dead schema imports
    // were removed (noUnusedLocals-safe).
    expect(after).toContain(`setRequestHandler('tools/list'`);
    expect(after).toContain(`setRequestHandler('tools/call'`);
    expect(after).not.toContain('ListToolsRequestSchema');
    expect(after).not.toContain('CallToolRequestSchema');
    // Symbols renamed.
    expect(after).toContain('new ProtocolError(ProtocolErrorCode.MethodNotFound');
    expect(after).toContain('NodeStreamableHTTPServerTransport');
    // Handler context migrated.
    expect(after).toContain('ctx.mcpReq.signal.throwIfAborted()');
    expect(after).toContain('ctx.mcpReq.notify(');
    expect(after).toContain('ctx.sessionId');
    // No v1 leftovers.
    expect(after).not.toContain('@modelcontextprotocol/sdk');
    expect(after).not.toContain('McpError');
  });

  it('--write swaps package.json dependencies for the split packages actually used', () => {
    runCodemod([tmp], { write: true });
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(pkg.dependencies['@modelcontextprotocol/server']).toBe('^2.0.0-beta.2');
    expect(pkg.dependencies['@modelcontextprotocol/node']).toBe('^2.0.0-beta.2');
    expect(pkg.dependencies['@modelcontextprotocol/core']).toBe('^2.0.0-beta.2');
    expect(pkg.dependencies.zod).toBe('^4.2.0');
  });

  it('after --write the v2 tier is clean; remaining findings are 2026 protocol advice', () => {
    runCodemod([tmp], { write: true });
    const { findings } = lintPaths([tmp]);
    const v2Errors = findings.filter((f) => f.tier === 'v2');
    expect(v2Errors).toHaveLength(0);
    // Session usage advice must survive (sessionIdGenerator + ctx.sessionId).
    const sessionFindings = findings.filter((f) => f.ruleId === '2026-session-usage');
    expect(sessionFindings.length).toBeGreaterThanOrEqual(2);
  });

  it('reports manual findings for things it refuses to auto-rewrite', () => {
    const withSse = path.join(tmp, 'src', 'sse.ts');
    fs.writeFileSync(
      withSse,
      `import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';\n`,
    );
    const run = runCodemod([tmp], {});
    expect(run.manualFindings.some((f) => f.file === withSse)).toBe(true);
  });

  it('is idempotent: a second --write pass changes nothing', () => {
    runCodemod([tmp], { write: true });
    const snapshot = fs.readFileSync(path.join(tmp, 'src', 'server.ts'), 'utf8');
    const second = runCodemod([tmp], { write: true });
    expect(second.totalFixes).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'src', 'server.ts'), 'utf8')).toBe(snapshot);
  });
});

describe('codemodText multi-pass fixing', () => {
  it('converges when one fix enables another', () => {
    // Import rename + symbol rename + handler migration all in one file.
    const code =
      `import { McpError } from '@modelcontextprotocol/sdk/types.js';\n` +
      `server.setRequestHandler(CallToolRequestSchema, async (req, extra) => extra.requestId);\n`;
    const { after, fixesApplied } = codemodText('f.ts', code);
    expect(after).toContain(`import { ProtocolError } from '@modelcontextprotocol/core';`);
    expect(after).toContain(`setRequestHandler('tools/call', async (req, ctx) => ctx.mcpReq.id);`);
    expect(fixesApplied).toBeGreaterThanOrEqual(4);
  });
});
