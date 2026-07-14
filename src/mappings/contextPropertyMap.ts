/**
 * v1 handler `extra: RequestHandlerExtra` property → v2 `ctx: ServerContext`
 * property (contextPropertyMap of the official codemod).
 */
export interface ContextPropertyMapping {
  to: string;
  /** When true the whole call expression is rewritten (method rename + optional call). */
  call?: boolean;
  note?: string;
}

export const contextPropertyMap: Record<string, ContextPropertyMapping> = {
  signal: { to: 'mcpReq.signal' },
  requestId: { to: 'mcpReq.id' },
  _meta: { to: 'mcpReq._meta' },
  sendRequest: { to: 'mcpReq.send' },
  sendNotification: { to: 'mcpReq.notify' },
  sessionId: {
    to: 'sessionId',
    note:
      'ctx.sessionId only exists on 2025-era connections; 2026-07-28 removes sessions — ' +
      'move cross-call state to explicit handles or the requestState codec.',
  },
  authInfo: { to: 'http?.authInfo' },
  requestInfo: { to: 'http?.req' },
  closeSSEStream: { to: 'http?.closeSSE?.()', call: true },
  closeStandaloneSSEStream: { to: 'http?.closeStandaloneSSE?.()', call: true },
};
