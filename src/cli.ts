#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { lintPaths } from './lint/linter.js';
import { formatJson, formatPretty, summarize } from './lint/format.js';
import { renderDiffs, runCodemod } from './codemod/codemod.js';
import { allRuleMetas } from './rules/index.js';
import { detectEra } from './detect.js';
import { startProxy, type Front } from './proxy/proxy.js';
import { consoleLogger } from './proxy/logger.js';
import {
  SUPPORTED_SPEC_VERSIONS,
  TARGET_SPEC_REVISION,
  TARGET_SPEC_STATUS,
  VERSION,
  type SpecVersion,
} from './version.js';

// Piped output (e.g. `mcp-shift rules | head`) can close stdout early; treat
// EPIPE as a normal end of output instead of crashing with a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

const HELP = `mcp-shift ${VERSION} — MCP ${TARGET_SPEC_REVISION} migration toolkit
(targets the ${TARGET_SPEC_STATUS})

Usage:
  mcp-shift lint [paths...]        Conformance-lint sources against the new spec
  mcp-shift codemod [paths...]     Rewrite sources (dry-run by default, --write to apply)
  mcp-shift proxy                  Bidirectional old<->new protocol compatibility proxy
  mcp-shift detect <url>           Probe which spec era a running server speaks
  mcp-shift rules                  List all lint rules

Lint / codemod options:
  --spec-version <v>               ${SUPPORTED_SPEC_VERSIONS.join(' | ')} (default: ${TARGET_SPEC_REVISION};
                                   2025-11-25 limits checks to the SDK v1->v2 tier)
  --rules <a,b,...>                Only run the listed rule IDs
  --format <pretty|json>           Lint output format (default: pretty)
  --max-warnings <n>               Fail lint when warnings exceed n
  --write                          Codemod: write changes to disk
  --sdk-version-range <range>      Codemod: version range for rewritten deps (default: ^2.0.0-beta.2)

Proxy options:
  --upstream <url>                 Upstream MCP endpoint (required)
  --listen <port>                  Port to listen on (default: 6277)
  --host <host>                    Host to bind (default: 127.0.0.1)
  --front <2025|2026|auto>         Era spoken to clients (default: auto — probe upstream, serve the other era)

Examples:
  mcp-shift lint src/
  mcp-shift codemod --write .
  mcp-shift proxy --upstream http://localhost:3000/mcp --listen 6277
  mcp-shift detect http://localhost:3000/mcp
`;

function fail(message: string): never {
  console.error(`mcp-shift: ${message}`);
  console.error(`Run 'mcp-shift --help' for usage.`);
  process.exit(2);
}

function parseSpecVersion(value: string | undefined): SpecVersion {
  if (value === undefined) return TARGET_SPEC_REVISION;
  if ((SUPPORTED_SPEC_VERSIONS as readonly string[]).includes(value)) return value as SpecVersion;
  return fail(`unsupported --spec-version '${value}' (supported: ${SUPPORTED_SPEC_VERSIONS.join(', ')})`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  switch (command) {
    case 'lint': {
      const { values, positionals } = parseArgs({
        args: argv.slice(1),
        allowPositionals: true,
        options: {
          'spec-version': { type: 'string' },
          rules: { type: 'string' },
          format: { type: 'string' },
          'max-warnings': { type: 'string' },
        },
      });
      const paths = positionals.length > 0 ? positionals : ['.'];
      const options = {
        specVersion: parseSpecVersion(values['spec-version']),
        ...(values.rules ? { rules: values.rules.split(',').map((r) => r.trim()) } : {}),
      };
      const { findings, fileCount } = lintPaths(paths, options);
      if (values.format === 'json') {
        process.stdout.write(formatJson(findings));
      } else {
        process.stdout.write(formatPretty(findings));
        process.stdout.write(`(scanned ${fileCount} file${fileCount === 1 ? '' : 's'}, targeting MCP ${options.specVersion})\n`);
      }
      const s = summarize(findings);
      const maxWarnings = values['max-warnings'] !== undefined ? Number(values['max-warnings']) : Infinity;
      process.exitCode = s.errors > 0 || s.warnings > maxWarnings ? 1 : 0;
      return;
    }

    case 'codemod': {
      const { values, positionals } = parseArgs({
        args: argv.slice(1),
        allowPositionals: true,
        options: {
          'spec-version': { type: 'string' },
          write: { type: 'boolean' },
          'sdk-version-range': { type: 'string' },
        },
      });
      const paths = positionals.length > 0 ? positionals : ['.'];
      const run = runCodemod(paths, {
        specVersion: parseSpecVersion(values['spec-version']),
        write: Boolean(values.write),
        ...(values['sdk-version-range'] ? { sdkVersionRange: values['sdk-version-range'] } : {}),
      });
      if (!values.write) {
        const diffs = renderDiffs(run);
        if (diffs) process.stdout.write(diffs);
      }
      process.stdout.write(
        `\n${values.write ? 'Applied' : 'Would apply'} ${run.totalFixes} fix${run.totalFixes === 1 ? '' : 'es'} ` +
          `across ${run.changedFiles} file${run.changedFiles === 1 ? '' : 's'}.\n`,
      );
      if (run.manualFindings.length > 0) {
        process.stdout.write(`\n${run.manualFindings.length} finding(s) need manual review:\n`);
        for (const f of run.manualFindings) {
          process.stdout.write(`  ${f.file}:${f.line}:${f.column}  [${f.ruleId}] ${f.message}\n`);
        }
      }
      if (!values.write && (run.changedFiles > 0 || run.manualFindings.length > 0)) {
        process.stdout.write(`\nDry run — re-run with --write to apply.\n`);
      }
      return;
    }

    case 'proxy': {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          upstream: { type: 'string' },
          listen: { type: 'string' },
          host: { type: 'string' },
          front: { type: 'string' },
          'mrtr-timeout': { type: 'string' },
        },
      });
      if (!values.upstream) fail('proxy requires --upstream <url>');
      const front = (values.front ?? 'auto') as Front | 'auto';
      if (!['2025', '2026', 'auto'].includes(front)) fail(`invalid --front '${values.front}'`);
      const port = values.listen !== undefined ? Number(values.listen) : 6277;
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid --listen '${values.listen}'`);
      const logger = consoleLogger();
      const proxy = await startProxy(
        {
          upstreamUrl: values.upstream,
          front,
          logger,
          ...(values['mrtr-timeout'] ? { mrtrTimeoutMs: Number(values['mrtr-timeout']) } : {}),
        },
        port,
        values.host ?? '127.0.0.1',
      );
      const facing = proxy.front === '2025' ? 'old (2025-era) clients' : `new (${TARGET_SPEC_REVISION}) clients`;
      logger.info(`listening on ${proxy.url} — serving ${facing}, upstream ${values.upstream}`);
      logger.info(`spec target: ${TARGET_SPEC_STATUS}`);
      const shutdown = (): void => {
        void proxy.close().then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      // Keep the process alive until signalled.
      await new Promise(() => {});
      return;
    }

    case 'detect': {
      const url = argv[1];
      if (!url) fail('detect requires a URL');
      const result = await detectEra(url);
      const label =
        result.era === 'modern'
          ? `${TARGET_SPEC_REVISION} (stateless)`
          : result.era === 'legacy'
            ? '2025-era (session-managed)'
            : 'unknown';
      process.stdout.write(`era:              ${label}\n`);
      process.stdout.write(`protocolVersions: ${result.protocolVersions.join(', ') || '-'}\n`);
      if (result.serverInfo) {
        process.stdout.write(`serverInfo:       ${JSON.stringify(result.serverInfo)}\n`);
      }
      process.stdout.write(`detail:           ${result.detail}\n`);
      process.exitCode = result.era === 'unknown' ? 1 : 0;
      return;
    }

    case 'rules': {
      process.stdout.write(`mcp-shift rules (targeting MCP ${TARGET_SPEC_REVISION} — ${TARGET_SPEC_STATUS})\n\n`);
      const byTier: Record<string, typeof allRuleMetas> = { v2: [], '2026': [] };
      for (const meta of allRuleMetas) byTier[meta.tier]!.push(meta);
      for (const tier of ['v2', '2026'] as const) {
        const metas = byTier[tier]!;
        process.stdout.write(
          tier === 'v2'
            ? 'Tier [v2] — TypeScript SDK v1 -> v2 surface breaks:\n'
            : `Tier [2026] — ${TARGET_SPEC_REVISION} protocol adoption:\n`,
        );
        for (const meta of metas) {
          const fix = meta.fixable ? 'fixable' : 'manual ';
          process.stdout.write(`  ${meta.severity.padEnd(5)} ${fix}  ${meta.id.padEnd(28)} ${meta.summary}\n`);
        }
        process.stdout.write('\n');
      }
      return;
    }

    default:
      fail(`unknown command '${command}'`);
  }
}

main().catch((err: Error) => {
  console.error(`mcp-shift: ${err.message}`);
  process.exit(1);
});
