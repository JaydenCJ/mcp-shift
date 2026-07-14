export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'method' in msg &&
    'id' in msg &&
    typeof (msg as JsonRpcRequest).method === 'string'
  );
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'method' in msg &&
    !('id' in msg) &&
    typeof (msg as JsonRpcNotification).method === 'string'
  );
}

export function isResponse(msg: unknown): msg is JsonRpcSuccess | JsonRpcFailure {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    !('method' in msg) &&
    'id' in msg &&
    ('result' in msg || 'error' in msg)
  );
}

export function isSuccess(msg: unknown): msg is JsonRpcSuccess {
  return isResponse(msg) && 'result' in msg;
}

export function makeError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

export function makeResult(id: JsonRpcId, result: Record<string, unknown>): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

/** JSON-RPC / MCP error codes used by the proxy. */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** 2026-07-28 spec-reserved codes (renumbered from draft-era -32001/-32003/-32004). */
  HeaderMismatch: -32020,
  MissingRequiredClientCapability: -32021,
  UnsupportedProtocolVersion: -32022,
  /** 2025-era resource-not-found (becomes -32602 in 2026-07-28). */
  LegacyResourceNotFound: -32002,
} as const;
