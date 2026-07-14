# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-08

Initial release. Targets the MCP **2026-07-28 release candidate** (locked
2026-05-21; the final revision ships on 2026-07-28 — rules will be re-verified
against the final changelog then).

### Added

- **`mcp-shift lint`** — conformance linter with 17 rules in two tiers:
  - `v2` tier (TypeScript SDK v1 → v2 surface): import-path splits
    (`@modelcontextprotocol/sdk` → `client`/`server`/`core`/`node`), removed
    SSE/WebSocket transports, symbol renames (`McpError`→`ProtocolError`,
    `StreamableHTTPError`→`SdkHttpError`, the JSON-RPC response family,
    `RequestHandlerExtra`→`ServerContext`, ...), variadic
    `server.tool/prompt/resource` registration, schema-first
    `setRequestHandler`, handler `extra`→`ctx` property remaps, result-schema
    argument drops, `completable(...).optional()` inversion, removed
    experimental-tasks surface, cleanup of schema imports left unused by the
    method-string migration (`noUnusedLocals`-safe output),
    `@modelcontextprotocol/sdk` and `zod@3` dependency checks in
    `package.json`.
  - `2026` tier (protocol adoption): removed methods (`initialize`, `ping`,
    `logging/setLevel`, `resources/subscribe|unsubscribe`, ...), session /
    `Mcp-Session-Id` usage, deprecated sampling/roots/logging capability APIs,
    renumbered error-code literals (`-32001/-32003/-32004` → `-32020/-32021/
    -32022`, `-32002` → `-32602`), wire-only `resultType` reads, and
    `x-mcp-header` parameter-type validation.
  - `--spec-version` flag (`2026-07-28` default, `2025-11-25` to restrict to
    the SDK tier), `--rules`, `--format json`, `--max-warnings`.
- **`mcp-shift codemod`** — mechanical migration with dry-run unified diffs
  and `--write`; multi-pass fixing (renames enabled by import rewrites land in
  the same run); rewrites `package.json` dependencies to exactly the v2 split
  packages the migrated sources import; prints the remaining manual-review
  findings as a migration report.
- **`mcp-shift proxy`** — bidirectional compatibility proxy:
  - *Legacy front* (old client → 2026-07-28 server): terminates
    `initialize`/`initialized` locally against `server/discover`, mints and
    manages `Mcp-Session-Id`, answers `ping` locally, converts
    `logging/setLevel` into the per-request `_meta` logLevel key, injects the
    `io.modelcontextprotocol/*` identity envelope and the required
    `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers (with Base64
    sentinel encoding), mirrors `x-mcp-header` tool arguments into
    `Mcp-Param-*` headers using cached `tools/list` schemas, strips
    `resultType`/`ttlMs`/`cacheScope` southbound, maps 2026-only error codes,
    translates `notifications/cancelled` into upstream stream aborts, and
    **bridges MRTR**: each `inputRequests` entry — a `{method, params}`
    request object per the RC `schema/draft/schema.json` — becomes a real
    2025 server→client `elicitation/create`/`sampling/createMessage`/
    `roots/list` request (whether the upstream answers with JSON or a
    per-request SSE body) with byte-exact `requestState` echo on retry;
    unbridgeable entries fail the request explicitly instead of being
    misrouted, and a client-side error on a bridged `sampling`/`roots` leg
    fails the request explicitly (only an errored elicitation leg maps to a
    valid decline).
  - *Modern front* (2026-07-28 client → old server): full southbound header
    validation (`-32020` HeaderMismatch, `-32022` UnsupportedProtocolVersion
    with `supported` list, 405 on GET/DELETE, 404 + `-32601` for removed
    methods and for unbridgeable core methods — `subscriptions/listen`,
    `tasks/*`), `server/discover` synthesized from one pinned upstream
    `initialize` (`supportedVersions` et al. per the RC DiscoverResult
    schema), envelope stripping northbound, `resultType`/cache-hint
    injection southbound, `-32002`→`-32602` error mapping, per-request
    logLevel → deduplicated upstream `logging/setLevel`, client disconnect →
    upstream `notifications/cancelled`.
  - `--front auto` probes the upstream era and serves the opposite one.
- **`mcp-shift detect`** — era probe implementing the spec's
  backward-compatibility probing (modern `server/discover` first, recognized
  modern error codes on 400, legacy `initialize` fallback, polite probe-session
  DELETE).
- **`mcp-shift rules`** — rule reference with tier/severity/fixability.
- Example assets: a deliberately outdated v1 server project
  (`examples/v1-server`), a standalone 2026-07-28 demo server, a 2025-era demo
  client with MRTR support, and a one-shot `examples/demo.sh` walkthrough.
- 108 unit/e2e tests (vitest), including full proxy round trips against real
  HTTP fixtures in both directions.
- `scripts/smoke.sh` — self-asserting protocol round-trip smoke test on
  `127.0.0.1` (lint findings, era detection, initialize → tools/list →
  tools/call through the proxy, invalid-input error handling).

[0.1.0]: https://github.com/JaydenCJ/mcp-shift/releases/tag/v0.1.0
