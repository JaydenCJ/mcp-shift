#!/usr/bin/env bash
# mcp-shift end-to-end demo.
#
# Prerequisite: `npm install && npm run build` in the repo root.
# Everything runs locally on 127.0.0.1.
set -euo pipefail
cd "$(dirname "$0")/.."

CLI="node dist/cli.js"
DEMO_DIR="$(mktemp -d)"
SERVER_PORT="${DEMO_SERVER_PORT:-3999}"
PROXY_PORT="${DEMO_PROXY_PORT:-6277}"
cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT

banner() { printf '\n\033[1m== %s ==\033[0m\n\n' "$1"; }

banner "1/5  mcp-shift lint — conformance-lint a v1 / 2025-era server"
$CLI lint examples/v1-server || true

banner "2/5  mcp-shift codemod --write — migrate it in one command"
cp -r examples/v1-server/. "$DEMO_DIR/"
$CLI codemod --write "$DEMO_DIR"
echo
echo "--- migrated src/server.ts (head) ---"
head -n 20 "$DEMO_DIR/src/server.ts"
echo "--- migrated package.json dependencies ---"
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('$DEMO_DIR/package.json','utf8')).dependencies, null, 2))"

banner "3/5  start a stateless 2026-07-28 demo server"
node examples/modern-server.mjs "$SERVER_PORT" &
SERVER_PID=$!
sleep 0.4

banner "4/5  mcp-shift detect — probe which era it speaks"
$CLI detect "http://127.0.0.1:$SERVER_PORT/"

banner "5/5  mcp-shift proxy — an unmodified 2025 client talks to it anyway"
$CLI proxy --upstream "http://127.0.0.1:$SERVER_PORT/" --listen "$PROXY_PORT" &
PROXY_PID=$!
sleep 0.6
node examples/legacy-client.mjs "http://127.0.0.1:$PROXY_PORT/"

echo
echo "Demo complete."
