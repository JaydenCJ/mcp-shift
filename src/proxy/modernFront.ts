/**
 * Modern front (direction "new client → old server").
 *
 * Southbound the proxy speaks 2026-07-28: POST-only endpoint, required
 * headers validated against the body (400 + -32020 HeaderMismatch), version
 * gate (400 + -32022), GET/DELETE → 405, `server/discover` answered from the
 * cached upstream `initialize`, results upgraded with `resultType` and cache
 * hints. Northbound it keeps one pinned 2025-era session alive (this
 * direction is inherently stateful — see the README "Spec status" section).
 */
import type http from 'node:http';
import {
  DEFAULT_LEGACY_NEGOTIATED_VERSION,
  MODERN_PROTOCOL_VERSION,
  VERSION,
} from '../version.js';
import {
  ErrorCodes,
  isNotification,
  isRequest,
  isSuccess,
  isResponse,
  makeError,
  makeResult,
  type JsonRpcFailure,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from './jsonrpc.js';
import { injectModernResultFields, readEnvelope, stripEnvelope } from './envelope.js';
import { decodeHeaderValue, mcpNameParam } from './headers.js';
import { postUpstream, readBody, sendEmpty, sendJson } from './http.js';
import type { ProxyLogger } from './logger.js';

const SESSION_HEADER = 'mcp-session-id';

/** Methods that no longer exist at the 2026-07-28 core protocol level. */
const REMOVED_SOUTHBOUND_METHODS = new Set([
  'initialize',
  'ping',
  'logging/setLevel',
  'resources/subscribe',
  'resources/unsubscribe',
]);

/**
 * 2026-07-28 core methods the proxy cannot bridge to a 2025-era upstream yet.
 * A 2026-only endpoint must answer methods it does not serve with HTTP 404 +
 * -32601 itself — forwarding them would surface a 2025-shaped HTTP 200
 * in-body error instead.
 */
const UNBRIDGED_SOUTHBOUND_METHODS = new Set(['subscriptions/listen']);

interface UpstreamSession {
  sessionId?: string;
  negotiatedVersion: string;
  serverInfo: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  instructions?: string;
  currentLogLevel?: string;
}

export interface ModernFrontOptions {
  upstreamUrl: string;
  logger: ProxyLogger;
}

export class ModernFront {
  private session: UpstreamSession | undefined;
  private initializing: Promise<UpstreamSession> | undefined;
  private requestCounter = 0;

  constructor(private readonly options: ModernFrontOptions) {}

  get upstreamUrl(): string {
    return this.options.upstreamUrl;
  }

  private upstreamHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.session) {
      headers['mcp-protocol-version'] = this.session.negotiatedVersion;
      if (this.session.sessionId) headers[SESSION_HEADER] = this.session.sessionId;
    }
    return headers;
  }

  /**
   * Lazily run the 2025 handshake upstream and pin the resulting session.
   * The first caller's envelope identity wins (per-request identity cannot be
   * expressed on a 2025 session — documented lossiness).
   */
  private async ensureSession(clientInfo?: Record<string, unknown>, clientCapabilities?: Record<string, unknown>): Promise<UpstreamSession> {
    if (this.session) return this.session;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const initRequest: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: `mcp-shift-init-${++this.requestCounter}`,
        method: 'initialize',
        params: {
          protocolVersion: DEFAULT_LEGACY_NEGOTIATED_VERSION,
          capabilities: clientCapabilities ?? {},
          clientInfo: clientInfo ?? { name: 'mcp-shift-proxy', version: VERSION },
        },
      };
      const upstream = await postUpstream(this.options.upstreamUrl, initRequest, {});
      if (upstream.kind !== 'json' || !upstream.message || !isSuccess(upstream.message)) {
        throw new Error(`Upstream initialize failed (HTTP ${upstream.status})`);
      }
      const result = upstream.message.result;
      const session: UpstreamSession = {
        negotiatedVersion:
          typeof result['protocolVersion'] === 'string'
            ? (result['protocolVersion'] as string)
            : DEFAULT_LEGACY_NEGOTIATED_VERSION,
        serverInfo: (result['serverInfo'] as Record<string, unknown>) ?? {},
        capabilities: (result['capabilities'] as Record<string, unknown>) ?? {},
      };
      if (typeof result['instructions'] === 'string') session.instructions = result['instructions'];
      const sid = upstream.headers.get(SESSION_HEADER);
      if (sid) session.sessionId = sid;
      this.session = session;
      // Complete the 2025 handshake.
      await postUpstream(
        this.options.upstreamUrl,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        this.upstreamHeaders(),
      );
      this.options.logger.info(
        `modern-front: pinned upstream session (${session.negotiatedVersion}${session.sessionId ? `, session ${session.sessionId}` : ''})`,
      );
      return session;
    })();
    try {
      return await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }

  private validationError(
    res: http.ServerResponse,
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    sendJson(res, 400, makeError(id, code, message, data));
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method === 'GET' || req.method === 'DELETE') {
        // SEP-2567/2575: the standalone GET stream and DELETE termination are gone.
        sendJson(
          res,
          405,
          makeError(
            null,
            ErrorCodes.InvalidRequest,
            `${req.method} is not supported by the 2026-07-28 Streamable HTTP transport (POST only)`,
          ),
          { allow: 'POST' },
        );
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, makeError(null, ErrorCodes.InvalidRequest, 'Method not allowed'), {
          allow: 'POST',
        });
        return;
      }
      await this.handlePost(req, res);
    } catch (err) {
      this.options.logger.error(`modern-front: ${(err as Error).message}`);
      if (!res.headersSent) {
        sendJson(res, 500, makeError(null, ErrorCodes.InternalError, (err as Error).message));
      } else {
        res.end();
      }
    }
  }

  private async handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const bodyText = await readBody(req);
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(bodyText) as JsonRpcMessage;
    } catch {
      sendJson(res, 400, makeError(null, ErrorCodes.ParseError, 'Invalid JSON'));
      return;
    }
    if (Array.isArray(message) || (!isRequest(message) && !isNotification(message))) {
      sendJson(res, 400, makeError(null, ErrorCodes.InvalidRequest, 'Expected a single JSON-RPC request or notification'));
      return;
    }
    const id = isRequest(message) ? message.id : null;

    // ---- Header validation (the proxy's duty as a 2026-facing server) ----
    const headerVersion = req.headers['mcp-protocol-version'];
    if (typeof headerVersion !== 'string' || headerVersion.length === 0) {
      this.validationError(
        res,
        id,
        ErrorCodes.UnsupportedProtocolVersion,
        'Missing MCP-Protocol-Version header',
        { supported: [MODERN_PROTOCOL_VERSION] },
      );
      return;
    }
    if (headerVersion !== MODERN_PROTOCOL_VERSION) {
      this.validationError(
        res,
        id,
        ErrorCodes.UnsupportedProtocolVersion,
        `Unsupported protocol version '${headerVersion}'`,
        { supported: [MODERN_PROTOCOL_VERSION], requested: headerVersion },
      );
      return;
    }
    const envelope = readEnvelope(message);
    if (envelope.protocolVersion !== undefined && envelope.protocolVersion !== headerVersion) {
      this.validationError(
        res,
        id,
        ErrorCodes.HeaderMismatch,
        'MCP-Protocol-Version header does not match the _meta envelope',
        { header: headerVersion, body: envelope.protocolVersion },
      );
      return;
    }
    const headerMethod = req.headers['mcp-method'];
    if (isRequest(message)) {
      if (typeof headerMethod !== 'string' || headerMethod.length === 0) {
        this.validationError(res, id, ErrorCodes.HeaderMismatch, 'Missing Mcp-Method header', {
          body: message.method,
        });
        return;
      }
      if (headerMethod !== message.method) {
        this.validationError(res, id, ErrorCodes.HeaderMismatch, 'Mcp-Method header does not match body method', {
          header: headerMethod,
          body: message.method,
        });
        return;
      }
      const nameParam = mcpNameParam(message.method);
      if (nameParam) {
        const bodyValue = (message.params as Record<string, unknown> | undefined)?.[nameParam];
        const headerName = req.headers['mcp-name'];
        if (typeof headerName !== 'string' || headerName.length === 0) {
          this.validationError(res, id, ErrorCodes.HeaderMismatch, `Missing Mcp-Name header for ${message.method}`, {
            body: bodyValue,
          });
          return;
        }
        if (typeof bodyValue === 'string' && decodeHeaderValue(headerName) !== bodyValue) {
          this.validationError(res, id, ErrorCodes.HeaderMismatch, 'Mcp-Name header does not match body', {
            header: decodeHeaderValue(headerName),
            body: bodyValue,
          });
          return;
        }
      }
    }
    // Note: header requirements for notification POSTs are explicitly
    // undefined in the RC transport spec — the proxy does not require them.

    if (isRequest(message) && REMOVED_SOUTHBOUND_METHODS.has(message.method)) {
      // Unknown/removed RPC method → HTTP 404 + -32601 (SEP-2575).
      sendJson(
        res,
        404,
        makeError(
          message.id,
          ErrorCodes.MethodNotFound,
          `'${message.method}' does not exist in MCP ${MODERN_PROTOCOL_VERSION}`,
        ),
      );
      return;
    }

    if (
      isRequest(message) &&
      (UNBRIDGED_SOUTHBOUND_METHODS.has(message.method) || message.method.startsWith('tasks/'))
    ) {
      // Answer these with 404 + -32601 ourselves instead of forwarding: the
      // 2025 upstream would reply HTTP 200 with an in-body -32601, which is
      // not how a 2026-only endpoint reports an unserved method.
      sendJson(
        res,
        404,
        makeError(
          message.id,
          ErrorCodes.MethodNotFound,
          message.method.startsWith('tasks/')
            ? `'${message.method}' is not part of the MCP ${MODERN_PROTOCOL_VERSION} core protocol — tasks moved to the io.modelcontextprotocol/tasks extension (SEP-2663)`
            : `'${message.method}' cannot be bridged to a 2025-era upstream yet (subscriptions/listen fan-out lands in 0.2 — see roadmap)`,
        ),
      );
      return;
    }

    if (isRequest(message) && message.method === 'server/discover') {
      await this.handleDiscover(message, res);
      return;
    }

    // ---- Forward northbound over the pinned 2025 session ----
    let session: UpstreamSession;
    try {
      session = await this.ensureSession(envelope.clientInfo, envelope.clientCapabilities);
    } catch (err) {
      sendJson(res, 502, makeError(id, ErrorCodes.InternalError, (err as Error).message));
      return;
    }

    // Per-request logLevel (2026) → session-scoped logging/setLevel (2025). Lossy: see README.
    if (envelope.logLevel !== undefined && envelope.logLevel !== session.currentLogLevel) {
      try {
        await postUpstream(
          this.options.upstreamUrl,
          {
            jsonrpc: '2.0',
            id: `mcp-shift-setlevel-${++this.requestCounter}`,
            method: 'logging/setLevel',
            params: { level: envelope.logLevel },
          },
          this.upstreamHeaders(),
        );
        session.currentLogLevel = envelope.logLevel;
      } catch (err) {
        this.options.logger.warn(`modern-front: logging/setLevel failed: ${(err as Error).message}`);
      }
    }

    const stripped = stripEnvelope(message);
    if (isNotification(stripped)) {
      try {
        await postUpstream(this.options.upstreamUrl, stripped, this.upstreamHeaders());
      } catch (err) {
        this.options.logger.warn(`modern-front: notification forward failed: ${(err as Error).message}`);
      }
      sendEmpty(res, 202);
      return;
    }

    const request = stripped as JsonRpcRequest;
    const controller = new AbortController();
    req.on('close', () => {
      // 2026 cancellation = the client closing the response stream; translate
      // into 2025 notifications/cancelled upstream.
      if (!res.writableEnded) {
        controller.abort();
        void postUpstream(
          this.options.upstreamUrl,
          {
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: request.id, reason: 'client closed response stream' },
          },
          this.upstreamHeaders(),
        ).catch(() => {});
      }
    });

    let upstream;
    try {
      upstream = await postUpstream(
        this.options.upstreamUrl,
        request,
        this.upstreamHeaders(),
        controller.signal,
      );
    } catch (err) {
      if (!res.headersSent && !controller.signal.aborted) {
        sendJson(res, 502, makeError(request.id, ErrorCodes.InternalError, (err as Error).message));
      }
      return;
    }

    if (upstream.kind === 'empty') {
      sendEmpty(res, upstream.status);
      return;
    }
    if (upstream.kind === 'sse') {
      // Roadmap: full SSE bridging (server→client requests become MRTR
      // input_required results). 0.1.0 rejects rather than mistranslating.
      sendJson(
        res,
        502,
        makeError(
          request.id,
          ErrorCodes.InternalError,
          'Upstream answered with an SSE stream; SSE bridging on the modern front lands in 0.2 (see roadmap)',
        ),
      );
      return;
    }
    const upstreamMessage = upstream.message;
    if (!upstreamMessage || !isResponse(upstreamMessage)) {
      sendJson(res, 502, makeError(request.id, ErrorCodes.InternalError, 'Upstream returned an unexpected payload'));
      return;
    }
    if (!isSuccess(upstreamMessage)) {
      const failure = upstreamMessage as JsonRpcFailure;
      // 2025 resource-not-found (-32002) → 2026 -32602 Invalid Params.
      if (failure.error.code === ErrorCodes.LegacyResourceNotFound) {
        sendJson(
          res,
          200,
          makeError(failure.id, ErrorCodes.InvalidParams, failure.error.message, failure.error.data),
        );
        return;
      }
      sendJson(res, 200, failure);
      return;
    }
    sendJson(
      res,
      200,
      makeResult(upstreamMessage.id, injectModernResultFields(upstreamMessage.result, request.method)),
    );
  }

  private async handleDiscover(message: JsonRpcRequest, res: http.ServerResponse): Promise<void> {
    const envelope = readEnvelope(message);
    let session: UpstreamSession;
    try {
      session = await this.ensureSession(envelope.clientInfo, envelope.clientCapabilities);
    } catch (err) {
      sendJson(res, 502, makeError(message.id, ErrorCodes.InternalError, (err as Error).message));
      return;
    }
    // DiscoverResult per schema/draft/schema.json — required members are
    // cacheScope, capabilities, resultType, serverInfo, supportedVersions,
    // ttlMs (to be re-verified against the final schema at spec release).
    const result: Record<string, unknown> = {
      resultType: 'complete',
      supportedVersions: [MODERN_PROTOCOL_VERSION],
      serverInfo: session.serverInfo,
      capabilities: session.capabilities,
      ttlMs: 0,
      cacheScope: 'private',
    };
    if (session.instructions) result['instructions'] = session.instructions;
    sendJson(res, 200, makeResult(message.id, result));
  }
}
