import type { PackageJsonRule } from '../core/types.js';

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function findKeyIndex(text: string, key: string): number {
  const idx = text.indexOf(`"${key}"`);
  return idx >= 0 ? idx : 0;
}

/**
 * v2-sdk-dependency — package.json still depends on the monolithic v1 SDK.
 */
export const sdkDependencyRule: PackageJsonRule = {
  meta: {
    id: 'v2-sdk-dependency',
    tier: 'v2',
    severity: 'error',
    summary: 'package.json depends on @modelcontextprotocol/sdk (v1); v2 ships as split packages.',
    fixable: true,
  },
  check(ctx) {
    for (const section of DEP_SECTIONS) {
      const deps = ctx.json[section];
      if (!deps || typeof deps !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(deps, '@modelcontextprotocol/sdk')) {
        ctx.report({
          index: findKeyIndex(ctx.text, '@modelcontextprotocol/sdk'),
          message:
            `${section} contains '@modelcontextprotocol/sdk' (v1). SDK v2 ships as split packages: ` +
            '@modelcontextprotocol/client, @modelcontextprotocol/server, @modelcontextprotocol/core, plus runtime ' +
            'adapters (@modelcontextprotocol/node|express|hono|fastify). `mcp-shift codemod --write` replaces the ' +
            'dependency based on the imports it rewrites.',
        });
      }
    }
  },
};

/**
 * v2-zod-major — SDK v2 requires zod ^4.2.0 (zod 3 fails at runtime on the
 * first tools/list).
 */
export const zodMajorRule: PackageJsonRule = {
  meta: {
    id: 'v2-zod-major',
    tier: 'v2',
    severity: 'error',
    summary: 'SDK v2 peer-depends on zod ^4.2.0; zod 3 fails at runtime on the first tools/list.',
    fixable: true,
  },
  check(ctx) {
    for (const section of DEP_SECTIONS) {
      const deps = ctx.json[section] as Record<string, string> | undefined;
      if (!deps || typeof deps !== 'object') continue;
      const version = deps['zod'];
      if (typeof version === 'string' && /^[\^~]?3\./.test(version)) {
        const keyIdx = findKeyIndex(ctx.text, 'zod');
        // Replace the version string literal that follows the "zod" key.
        const after = ctx.text.indexOf('"', ctx.text.indexOf(':', keyIdx));
        const close = ctx.text.indexOf('"', after + 1);
        ctx.report({
          index: keyIdx,
          message:
            `zod ${version} in ${section}: SDK v2 peer-depends on zod ^4.2.0 — zod 3 schemas fail at runtime on ` +
            'the first tools/list. Upgrade to ^4.2.0.',
          fix:
            after > 0 && close > after
              ? [{ start: after, end: close + 1, text: '"^4.2.0"' }]
              : undefined,
        });
      }
    }
  },
};

export const packageJsonRules: PackageJsonRule[] = [sdkDependencyRule, zodMajorRule];
