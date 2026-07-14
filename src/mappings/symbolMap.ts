/**
 * Symbol renames between SDK v1 and v2 (docs/migration/upgrade-to-v2.md).
 */
export interface SymbolMapping {
  to: string;
  note?: string;
  /** When true, references are renamed but the import specifier is deleted (global symbol). */
  global?: boolean;
}

export const symbolMap: Record<string, SymbolMapping> = {
  McpError: { to: 'ProtocolError' },
  ErrorCode: {
    to: 'ProtocolErrorCode',
    note:
      'ErrorCode.RequestTimeout / ErrorCode.ConnectionClosed become SdkError + SdkErrorCode.* (string codes, no longer -32001/-32000).',
  },
  StreamableHTTPServerTransport: {
    to: 'NodeStreamableHTTPServerTransport',
    note:
      'Node req/res flavor from @modelcontextprotocol/node. Constructor options are unchanged. ' +
      'On web-standard runtimes use WebStandardStreamableHTTPServerTransport from @modelcontextprotocol/server.',
  },
  StreamableHTTPError: {
    to: 'SdkHttpError',
    note:
      'SdkHttpError.code is an SdkErrorCode string; the HTTP status moved to .status/.statusText. ' +
      'Constructor call sites need review: new SdkHttpError(SdkErrorCode.X, message, { status, statusText }).',
  },
  JSONRPCError: { to: 'JSONRPCErrorResponse' },
  JSONRPCErrorSchema: { to: 'JSONRPCErrorResponseSchema' },
  isJSONRPCError: { to: 'isJSONRPCErrorResponse' },
  isJSONRPCResponse: {
    to: 'isJSONRPCResultResponse',
    note:
      'v2 reuses the name JSONRPCResponse for the result|error union; the v1 result-only semantics are ' +
      'preserved by the *ResultResponse family.',
  },
  JSONRPCResponse: { to: 'JSONRPCResultResponse' },
  JSONRPCResponseSchema: { to: 'JSONRPCResultResponseSchema' },
  ResourceReference: { to: 'ResourceTemplateReference' },
  ResourceReferenceSchema: { to: 'ResourceTemplateReferenceSchema' },
  RequestHandlerExtra: {
    to: 'ServerContext',
    note: 'ServerContext takes no type parameters. Client-side handlers use ClientContext.',
  },
  IsomorphicHeaders: {
    to: 'Headers',
    global: true,
    note: 'Web-standard Headers is global; bracket reads become .get("header-name").',
  },
};
