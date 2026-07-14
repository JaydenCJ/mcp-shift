#!/usr/bin/env node
/**
 * A tiny OLD (2025-era) MCP client: initialize handshake, Mcp-Session-Id,
 * ping, tools/list, tools/call — and it answers server→client elicitation
 * requests, so it can demonstrate the proxy's MRTR bridging.
 *
 *   node examples/legacy-client.mjs <proxy-url>
 */
const url = process.argv[2] ?? 'http://127.0.0.1:6277/';

let sessionId;

async function post(body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.headers.get('mcp-session-id')) sessionId = res.headers.get('mcp-session-id');
  return res;
}

function log(step, detail) {
  console.log(`[legacy-client] ${step}${detail !== undefined ? ` → ${detail}` : ''}`);
}

// --- 1. 2025-era initialize handshake ---------------------------------------
const initRes = await post({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: { elicitation: {} },
    clientInfo: { name: 'demo-legacy-client', version: '1.0.0' },
  },
});
const init = await initRes.json();
log('initialize', `${init.result.serverInfo.name} (protocol ${init.result.protocolVersion}, session ${sessionId})`);
await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
log('notifications/initialized', 'sent');

// --- 2. ping (removed in 2026-07-28 — the proxy answers locally) ------------
const ping = await (await post({ jsonrpc: '2.0', id: 2, method: 'ping' })).json();
log('ping', JSON.stringify(ping.result));

// --- 3. tools/list -----------------------------------------------------------
const tools = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).json();
log('tools/list', tools.result.tools.map((t) => t.name).join(', '));

// --- 4. plain tools/call ------------------------------------------------------
const echo = await (
  await post({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'echo', arguments: { text: 'hello from 2025' } },
  })
).json();
log("tools/call 'echo'", echo.result.content[0].text);

// --- 5. MRTR bridging: the tool needs user input ------------------------------
// The 2026 server answers `input_required`; the proxy converts that into a
// real 2025 server→client elicitation request on this POST's SSE stream.
const mrtrRes = await post({
  jsonrpc: '2.0',
  id: 5,
  method: 'tools/call',
  params: { name: 'pick-color', arguments: {} },
});
if (!mrtrRes.headers.get('content-type')?.includes('text/event-stream')) {
  console.error('expected an SSE response for the MRTR call');
  process.exit(1);
}

const reader = mrtrRes.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let finalResult;

outer: for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let sep;
  while ((sep = buffer.indexOf('\n\n')) !== -1) {
    const block = buffer.slice(0, sep);
    buffer = buffer.slice(sep + 2);
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const message = JSON.parse(dataLines.join('\n'));
    if (message.method === 'elicitation/create') {
      log('← elicitation/create', `"${message.params.message}" — answering: teal`);
      await post({
        jsonrpc: '2.0',
        id: message.id,
        result: { action: 'accept', content: { color: 'teal' } },
      });
    } else if (message.id === 5) {
      finalResult = message;
      break outer;
    }
  }
}
log("tools/call 'pick-color'", finalResult.result.content[0].text);

// --- 6. terminate the session --------------------------------------------------
await fetch(url, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
log('DELETE session', 'terminated');
console.log('[legacy-client] done — a 2025 client just used a stateless 2026-07-28 server.');
