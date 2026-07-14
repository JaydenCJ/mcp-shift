#!/usr/bin/env bash
# Protocol round-trip smoke test for mcp-shift.
#
# Starts the stateless 2026-07-28 demo server and the mcp-shift compatibility
# proxy on 127.0.0.1, then drives an unmodified 2025-era client through
# initialize -> tools/list -> tools/call (incl. an MRTR elicitation round
# trip), sends an invalid request to prove spec-conformant error handling
# without a crash, and asserts every step. Also lints the bundled v1 fixture.
#
# Requirements honored here: self-asserting, idempotent, no network beyond
# the 127.0.0.1 loopback, prints SMOKE OK as the last line on success.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_PORT="${SMOKE_SERVER_PORT:-3931}"
PROXY_PORT="${SMOKE_PROXY_PORT:-3932}"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""
PROXY_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "[smoke] FAIL: $1" >&2
  exit 1
}

step() { echo "[smoke] $1"; }

wait_for_port() {
  local port="$1" tries=50
  while ! node -e "
    const s = require('node:net').connect($port, '127.0.0.1');
    s.on('connect', () => { s.end(); process.exit(0); });
    s.on('error', () => process.exit(1));
  " 2>/dev/null; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || fail "port $port did not open in time"
    sleep 0.2
  done
}

# --- 0. prerequisites --------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "node not found on PATH"
[ -d node_modules ] || fail "dependencies missing — run 'npm ci' first"
if [ ! -f dist/cli.js ]; then
  step "dist/ missing — building once (tsc)"
  npm run build >/dev/null 2>&1 || fail "npm run build failed"
fi

# --- 1. conformance lint on the bundled v1 fixture ---------------------------
step "lint examples/v1-server (expect findings, exit code 1)"
set +e
LINT_OUT="$(node dist/cli.js lint examples/v1-server 2>&1)"
LINT_EXIT=$?
set -e
[ "$LINT_EXIT" -eq 1 ] || fail "lint exit code was $LINT_EXIT, expected 1"
echo "$LINT_OUT" | grep -q '22 problems (20 errors, 2 warnings)' \
  || fail "lint did not report the expected findings on the v1 fixture"

# --- 2. start the stateless 2026-07-28 demo server (loopback only) -----------
step "starting 2026-07-28 demo server on 127.0.0.1:$SERVER_PORT"
node examples/modern-server.mjs "$SERVER_PORT" >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
wait_for_port "$SERVER_PORT"

# --- 3. era detection ---------------------------------------------------------
step "detect http://127.0.0.1:$SERVER_PORT/"
DETECT_OUT="$(node dist/cli.js detect "http://127.0.0.1:$SERVER_PORT/")"
echo "$DETECT_OUT" | grep -q '2026-07-28 (stateless)' \
  || fail "detect did not identify the modern era: $DETECT_OUT"

# --- 4. start the compatibility proxy (defaults to 127.0.0.1) ----------------
step "starting proxy on 127.0.0.1:$PROXY_PORT (front auto)"
node dist/cli.js proxy --upstream "http://127.0.0.1:$SERVER_PORT/" \
  --listen "$PROXY_PORT" >"$TMP_DIR/proxy.log" 2>&1 &
PROXY_PID=$!
wait_for_port "$PROXY_PORT"

# --- 5. protocol round trip: initialize -> tools/list -> tools/call ----------
step "2025 client round trip through the proxy"
CLIENT_OUT="$(node examples/legacy-client.mjs "http://127.0.0.1:$PROXY_PORT/")"
echo "$CLIENT_OUT" | grep -q 'initialize → demo-modern-server (protocol 2025-11-25' \
  || fail "initialize handshake did not complete"
echo "$CLIENT_OUT" | grep -q 'tools/list → echo, pick-color' \
  || fail "tools/list did not return the expected tools"
echo "$CLIENT_OUT" | grep -q "tools/call 'echo' → echo: hello from 2025" \
  || fail "tools/call 'echo' did not round-trip"
echo "$CLIENT_OUT" | grep -q "tools/call 'pick-color' → you picked teal" \
  || fail "MRTR elicitation bridge did not round-trip"
echo "$CLIENT_OUT" | grep -q 'done — a 2025 client just used a stateless 2026-07-28 server\.' \
  || fail "client did not finish cleanly"

# --- 6. invalid input returns a spec error and nothing crashes ----------------
step "invalid requests get JSON-RPC errors (no crash)"
INVALID_OUT="$(node --input-type=module -e "
  const url = 'http://127.0.0.1:$PROXY_PORT/';
  const post = async (body, headers = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(body),
    });
  // initialize to get a session first
  const initRes = await post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
  });
  const session = initRes.headers.get('mcp-session-id');
  if (!session) throw new Error('no session minted');
  // unknown method -> -32601 from the upstream, passed through
  const unknown = await (await post({ jsonrpc: '2.0', id: 2, method: 'no/such-method' }, { 'mcp-session-id': session })).json();
  if (unknown.error?.code !== -32601) throw new Error('unknown method: expected -32601, got ' + JSON.stringify(unknown));
  // unknown tool -> -32602 invalid params
  const badTool = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope', arguments: {} } }, { 'mcp-session-id': session })).json();
  if (badTool.error?.code !== -32602) throw new Error('unknown tool: expected -32602, got ' + JSON.stringify(badTool));
  // proxy still alive after the errors: a valid call succeeds
  const ok = await (await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { text: 'still alive' } } }, { 'mcp-session-id': session })).json();
  if (ok.result?.content?.[0]?.text !== 'echo: still alive') throw new Error('post-error call failed: ' + JSON.stringify(ok));
  console.log('errors-ok');
")"
echo "$INVALID_OUT" | grep -q 'errors-ok' || fail "invalid-input error handling assertions failed"

step "all assertions passed"
echo "SMOKE OK"
