import { describe, expect, it } from 'vitest';
import { lintText } from '../src/lint/linter.js';
import { rewritePackageJson } from '../src/codemod/codemod.js';

describe('package.json rules', () => {
  const pkg = JSON.stringify(
    {
      name: 'my-server',
      dependencies: {
        '@modelcontextprotocol/sdk': '^1.20.0',
        zod: '^3.25.0',
        express: '^4.19.0',
      },
    },
    null,
    2,
  );

  it('flags the v1 SDK dependency and the zod 3 range', () => {
    const findings = lintText('/proj/package.json', pkg);
    const ids = findings.map((f) => f.ruleId).sort();
    expect(ids).toEqual(['v2-sdk-dependency', 'v2-zod-major']);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('auto-fixes the zod range to ^4.2.0', () => {
    const findings = lintText('/proj/package.json', pkg);
    const zodFinding = findings.find((f) => f.ruleId === 'v2-zod-major');
    expect(zodFinding?.fix).toBeDefined();
    const edit = zodFinding!.fix![0]!;
    const fixed = pkg.slice(0, edit.start) + edit.text + pkg.slice(edit.end);
    expect(JSON.parse(fixed).dependencies.zod).toBe('^4.2.0');
  });

  it('rewritePackageJson swaps the sdk dep for the split packages actually imported', () => {
    const out = rewritePackageJson(
      pkg,
      new Set(['@modelcontextprotocol/server', '@modelcontextprotocol/node']),
    );
    const json = JSON.parse(out);
    expect(json.dependencies['@modelcontextprotocol/sdk']).toBeUndefined();
    expect(json.dependencies['@modelcontextprotocol/server']).toBe('^2.0.0-beta.2');
    expect(json.dependencies['@modelcontextprotocol/node']).toBe('^2.0.0-beta.2');
    expect(json.dependencies.express).toBe('^4.19.0'); // untouched
  });

  it('does not flag package.json files without MCP dependencies', () => {
    const clean = JSON.stringify({ name: 'x', dependencies: { zod: '^4.2.0' } });
    expect(lintText('/proj/package.json', clean)).toHaveLength(0);
  });
});
