import type { Severity } from '../core/types.js';

/**
 * Protocol methods removed, replaced, or deprecated by the 2026-07-28
 * revision (RC locked 2026-05-21). Sources: draft changelog (SEP-2567,
 * SEP-2575, SEP-2322, SEP-2663, SEP-2577, SEP-2596) and the Streamable HTTP
 * draft transport spec.
 */
export interface RemovedMethodInfo {
  severity: Severity;
  message: string;
}

export const removedMethods: Record<string, RemovedMethodInfo> = {
  initialize: {
    severity: 'error',
    message:
      "'initialize' is removed in 2026-07-28 (SEP-2575): every request carries identity in params._meta " +
      "(io.modelcontextprotocol/protocolVersion|clientInfo|clientCapabilities); servers MUST implement 'server/discover'.",
  },
  'notifications/initialized': {
    severity: 'error',
    message:
      "'notifications/initialized' is removed in 2026-07-28 (SEP-2575) together with the initialize handshake.",
  },
  ping: {
    severity: 'error',
    message:
      "'ping' is removed in 2026-07-28 (SEP-2575). Liveness is a transport concern (HTTP request success, SSE keep-alives).",
  },
  'logging/setLevel': {
    severity: 'error',
    message:
      "'logging/setLevel' is removed in 2026-07-28 (SEP-2575). Log level is per-request via the " +
      "_meta key io.modelcontextprotocol/logLevel; absence of the key means the client opted out.",
  },
  'resources/subscribe': {
    severity: 'error',
    message:
      "'resources/subscribe' is removed in 2026-07-28 (SEP-2575). Use the long-lived 'subscriptions/listen' " +
      "request with a 'resourceSubscriptions' filter.",
  },
  'resources/unsubscribe': {
    severity: 'error',
    message:
      "'resources/unsubscribe' is removed in 2026-07-28 (SEP-2575). Subscription lifetime is the lifetime of the " +
      "'subscriptions/listen' stream.",
  },
  'notifications/roots/list_changed': {
    severity: 'error',
    message: "'notifications/roots/list_changed' is removed in 2026-07-28 (SEP-2575); roots are deprecated (SEP-2577).",
  },
  'notifications/elicitation/complete': {
    severity: 'error',
    message:
      "'notifications/elicitation/complete' (introduced 2025-11-25) is removed in 2026-07-28; URL-mode elicitation " +
      'completes by retrying the original request with inputResponses (MRTR, SEP-2322).',
  },
  'tasks/list': {
    severity: 'error',
    message:
      "'tasks/list' is removed (SEP-2663). Tasks moved to the io.modelcontextprotocol/tasks extension; " +
      "on 2026-era core connections inbound 'tasks/*' answers -32601.",
  },
  'tasks/result': {
    severity: 'error',
    message:
      "Blocking 'tasks/result' is replaced by polling 'tasks/get' in the io.modelcontextprotocol/tasks extension (SEP-2663).",
  },
  'sampling/createMessage': {
    severity: 'warn',
    message:
      'Sampling is deprecated (SEP-2577) and the server→client request channel is gone on 2026-era Streamable HTTP; ' +
      'integrate with LLM provider APIs directly, or return an MRTR input_required result (SEP-2322).',
  },
  'elicitation/create': {
    severity: 'warn',
    message:
      'Server→client elicitation requests are gone on 2026-era Streamable HTTP (SEP-2575); return ' +
      "inputRequired({ inputRequests: ... }) and read ctx.mcpReq.inputResponses on re-entry (MRTR, SEP-2322).",
  },
  'roots/list': {
    severity: 'warn',
    message:
      'Roots are deprecated (SEP-2577): pass directories/files as tool parameters, resource URIs, or server config.',
  },
};

/** Identifiers from the removed experimental-tasks SDK surface (SEP-2663). */
export const removedTaskIdentifiers = new Set([
  'taskManager',
  'taskStore',
  'taskMessageQueue',
  'TaskStore',
  'InMemoryTaskStore',
  'TaskMessageQueue',
  'InMemoryTaskMessageQueue',
  'registerToolTask',
  'ToolTaskHandler',
  'TaskRequestHandler',
  'CreateTaskRequestHandler',
  'CreateTaskOptions',
  'requestStream',
  'callToolStream',
  'createMessageStream',
  'elicitInputStream',
  'ResponseMessage',
  'assertTaskCapability',
  'assertTaskHandlerCapability',
  'ExperimentalClientTasks',
  'ExperimentalServerTasks',
  'ExperimentalMcpServerTasks',
  'isTerminal',
]);

/**
 * Deprecated capability APIs (SEP-2577 / SEP-2596) — still work on 2025-era
 * connections through the legacy shim, but throw or degrade on 2026-era.
 */
export const deprecatedCapabilityApis: Record<string, string> = {
  createMessage:
    'Server.createMessage() (sampling) is deprecated; on 2026-era requests use MRTR inputRequired(...) or call your LLM provider directly.',
  listRoots:
    'Server.listRoots() is deprecated; pass directories/files via tool parameters, resource URIs, or server config.',
  sendLoggingMessage:
    'sendLoggingMessage() is deprecated; log to stderr (stdio) or OpenTelemetry. notifications/message may only be sent ' +
    'for requests whose _meta carried io.modelcontextprotocol/logLevel.',
  setLoggingLevel:
    "Client.setLoggingLevel() is deprecated; set the per-request _meta key io.modelcontextprotocol/logLevel instead.",
  sendRootsListChanged:
    'Client.sendRootsListChanged() is deprecated; notifications/roots/list_changed is removed in 2026-07-28.',
  elicitInput:
    'ctx.mcpReq.elicitInput() throws on 2026-era requests; rewrite to return inputRequired({ inputRequests: { id: ' +
    "inputRequired.elicit({...}) } }) and read acceptedContent(ctx.mcpReq.inputResponses, 'id', schema) on re-entry.",
  requestSampling:
    'ctx.mcpReq.requestSampling() is deprecated; prefer MRTR inputRequired(...) or direct provider integration.',
};

/**
 * Renumbered / retired JSON-RPC error codes.
 * -32000..-32019 stay implementation-defined (grandfathered);
 * -32020..-32099 are reserved for the MCP spec as of 2026-07-28.
 */
export const errorCodeLiterals: Record<number, string> = {
  [-32001]:
    '-32001 was the draft-era HeaderMismatch code, renumbered to -32020 in the locked RC ' +
    '(and -32001 is also the legacy SDK "Session not found" convention). Use ProtocolErrorCode.* instead of literals.',
  [-32002]:
    '-32002 (resource not found) becomes -32602 Invalid Params in 2026-07-28. ' +
    'Accept both while you support 2025-era peers.',
  [-32003]:
    '-32003 was the draft-era MissingRequiredClientCapability code, renumbered to -32021 in the locked RC.',
  [-32004]:
    '-32004 was the draft-era UnsupportedProtocolVersion code, renumbered to -32022 in the locked RC.',
};
