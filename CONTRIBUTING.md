# Contributing to mcp-shift

Thanks for helping the MCP ecosystem through the 2026-07-28 transition. This
project lives or dies by the precision of its rules, so contributions that
cite the spec are the most valuable ones.

## Ground rules

- **Cite your sources.** Every rule, codemod mapping and proxy behavior must
  trace back to a primary source: the spec changelog
  (`modelcontextprotocol.io/specification/draft/changelog`), the Streamable
  HTTP transport spec, a SEP, or the official SDK migration guides
  (`docs/migration/*` in `modelcontextprotocol/typescript-sdk`). PRs that
  change behavior should link the exact section.
- **The final spec is not out yet.** Until 2026-07-28 we track the locked RC.
  If the final revision diverges, fixing the divergence takes priority over
  everything else — please open an issue with a link to the final changelog
  entry.
- **No false autofixes.** A codemod that produces wrong code is worse than no
  codemod. When a rewrite is not provably safe, report a manual finding
  instead (`fix` omitted). The test suite must prove every fix on realistic
  input.

## Development setup

```bash
git clone https://github.com/JaydenCJ/mcp-shift
cd mcp-shift
npm install
npm run build     # tsc → dist/
npm test          # vitest (unit + e2e proxy tests against local HTTP fixtures)
```

Requirements: Node >= 20 (the proxy uses global `fetch` and `node:http`).

Useful loops:

```bash
npm run test:watch                 # vitest watch mode
node dist/cli.js lint examples/v1-server
node dist/cli.js codemod examples/v1-server   # dry-run diff
bash examples/demo.sh              # full end-to-end walkthrough
```

## Project layout

```
src/
  cli.ts                 CLI entry (node:util parseArgs, no CLI framework)
  version.ts             spec-target constants (single source of truth)
  core/                  Finding/Rule/TextEdit types, parser, edit applier
  mappings/              data tables: importMap, symbolMap, schemaToMethodMap,
                         contextPropertyMap, removedMethods
  rules/                 lint rules (AST rules + package.json rules)
  lint/                  file discovery, rule driver, output formatting
  codemod/               multi-pass fixer, package.json rewriter, unified diff
  proxy/                 legacyFront (old→new), modernFront (new→old),
                         envelope/header/SSE/JSON-RPC helpers
  detect.ts              era probing
test/                    vitest suites + HTTP server fixtures (test/helpers/)
examples/                demo assets (v1 project, demo server/client, demo.sh)
```

## Adding a lint rule

1. Decide the tier: `v2` (SDK v1→v2 surface) or `2026` (protocol adoption).
2. Add any new mapping data to `src/mappings/` — rules should stay thin and
   data-driven.
3. Implement the rule in the matching file under `src/rules/` (implement
   `Rule` from `src/core/types.ts`). Report a `fix` (array of `TextEdit`)
   only when the rewrite is mechanically safe.
4. Register it in `src/rules/index.ts`.
5. Add tests: at least one positive case, one negative case (code that must
   NOT be flagged), and — if fixable — a codemod assertion via `codemodText`.
6. Update the CHANGELOG (the live rule reference is `mcp-shift rules`); if
   the change affects README content, update all three READMEs (`README.md`,
   `README.zh.md`, `README.ja.md`) in the same commit.

Rule ID conventions: `v2-*` / `2026-*` prefix by tier, kebab-case, imperative
enough to grep (`2026-removed-method`, `v2-handler-context`, ...).

## Changing proxy behavior

Both proxy directions are covered by end-to-end tests that run real HTTP
servers (`test/helpers/legacyServer.ts`, `test/helpers/modernServer.ts`).
When you change bridging semantics:

- extend the relevant fixture so the behavior is observable,
- assert on what actually crossed the wire (the fixtures record every request
  including headers and `_meta`),
- document any *lossy* translation in the "Spec status" section of all three
  READMEs.

## Pull requests

- Keep PRs focused; rule additions and proxy changes should be separate.
- `npm run build && npm test` must pass.
- Describe the spec source in the PR body (SEP number or changelog anchor).
- New user-facing behavior needs README updates in **all three languages**
  (English is the source of truth; machine-assisted translation is fine if
  you flag it for native review).

## Reporting spec drift

The most valuable issue you can file between now and the final release:
"the final 2026-07-28 spec says X, mcp-shift assumes Y", with a link. Label:
`spec-drift`.

## License

By contributing you agree that your contributions are licensed under the
MIT License.
