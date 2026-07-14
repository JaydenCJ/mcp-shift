/**
 * Legacy front (direction "old client → new server").
 *
 * Southbound the proxy speaks 2025-era Streamable HTTP (sessions, initialize
 * handshake, ping, logging/setLevel, server→client requests on SSE streams).
 * Northbound it speaks 2026-07-28 (stateless POSTs, per-request `_meta`
 * envelope, required headers, MRTR).
 */
import crypto from 'node:crypto';
import type http from 'node:http';
import {
  DEFAULT_LEGACY_NEGOTIATED_VERSION,
  LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSION,
  VERSION,
} from '../version.js';
import {
  ErrorCodes,
  isNotification,
  isRequest,
  isResponse,
  isSuccess,
  makeError,
  makeResult,
  type JsonRpcFailure,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcSuccess,
} from './jsonrpc.js';
import { injectEnvelope, stripModernResultFields, type EnvelopeIdentity } from './envelope.js';
import { encodeHeaderValue, headerNameForParam, mcpNameParam } from './headers.js';
import { postUpstream, readBody, sendEmpty, sendJson, startSse } from './http.js';
import { serializeSseEvent, sseComment, SseParser } from './sse.js';
import type { ProxyLogger } from './logger.js';

interface Session {
  id: string;
  clientInfo?: Record<string, unknown>;
  clientCapabilities?: Record<string, unknown>;
  logLevel?: string;
  negotiatedVersion: string;
}

interface PendingServerRequest {
  resolve: (message: JsonRpcMessage) => void;
  reject: (err: Error) => void;
}

interface HeaderParamMapping {
  property: string;
  header: string;
}

const SESSION_HEADER = 'mcp-session-id';
const MRTR_MAX_ROUNDS = 5;

export interface LegacyFrontOptions {
  upstreamUrl: string;
  logger: ProxyLogger;
  /** Milliseconds to wait for the old client to answer a bridged server→client request. */
  mrtrTimeoutMs?: number;
}

export class LegacyFront {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingServerRequests = new Map<string, PendingServerRequest>();
  private readonly inflight = new Map<string, AbortController>();
  /** tools/list-derived x-mcp-header mappings: tool name → header params. */
  private readonly headerParams = new Map<string, HeaderParamMapping[]>();
  private discoverCache: Record<string, unknown> | undefined;
  private serverRequestCounter = 0;

  constructor(private readonly options: LegacyFrontOptions) {}

  get upstreamUrl(): string {
    return this.options.upstreamUrl;
  }

  private get identity(): EnvelopeIdentity {
    return {
      clientInfo: { name: 'mcp-shift-proxy', version: VERSION },
      clientCapabilities: {},
    };
  }

  private modernHeaders(message: JsonRpcRequest | { method: string; params?: Record<string, unknown> }): Record<string, string> {
    const headers: Record<string, string> = {
      'mcp-protocol-version': MODERN_PROTOCOL_VERSION,
      'mcp-method': message.method,
    };
    const nameParam = mcpNameParam(message.method);
    if (nameParam) {
      const value = (message.params as Record<string, unknown> | undefined)?.[nameParam];
      if (typeof value === 'string') headers['mcp-name'] = encodeHeaderValue(value);
    }
    if (message.method === 'tools/call') {
      const params = message.params as Record<string, unknown> | undefined;
      const toolName = params?.['name'];
      const args = params?.['arguments'] as Record<string, unknown> | undefined;
      if (typeof toolName === 'string' && args) {
        for (const mapping of this.headerParams.get(toolName) ?? []) {
          const value = args[mapping.property];
          if (value === undefined || value === null) continue;
          if (typeof value === 'object') continue; // primitives only
          headers[mapping.header.toLowerCase()] = encodeHeaderValue(String(value));
        }
      }
    }
    return headers;
  }

  private async discover(): Promise<Record<string, unknown>> {
    if (this.discoverCache) return this.discoverCache;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `mcp-shift-discover-${crypto.randomUUID()}`,
      method: 'server/discover',
      params: {},
    };
    const stamped = injectEnvelope(request, this.identity) as JsonRpcRequest;
    const upstream = await postUpstream(
      this.options.upstreamUrl,
      stamped,
      this.modernHeaders(stamped),
    );
    if (upstream.kind === 'json' && upstream.message && isSuccess(upstream.message)) {
      this.discoverCache = upstream.message.result;
      return upstream.message.result;
    }
    throw new Error(
      `server/discover failed against ${this.options.upstreamUrl} (HTTP ${upstream.status})`,
    );
  }

  private negotiateVersion(requested: unknown): string {
    if (typeof requested === 'string' && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
      return requested;
    }
    return DEFAULT_LEGACY_NEGOTIATED_VERSION;
  }

  /** Record x-mcp-header annotations from a forwarded tools/list result. */
  private recordHeaderParams(result: Record<string, unknown>): void {
    const tools = result['tools'];
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = (tool as Record<string, unknown>)['name'];
      const inputSchema = (tool as Record<string, unknown>)['inputSchema'] as
        | Record<string, unknown>
        | undefined;
      if (typeof name !== 'string' || !inputSchema) continue;
      const properties = inputSchema['properties'] as Record<string, unknown> | undefined;
      if (!properties) continue;
      const mappings: HeaderParamMapping[] = [];
      for (const [prop, schema] of Object.entries(properties)) {
        if (!schema || typeof schema !== 'object') continue;
        const annotation = (schema as Record<string, unknown>)['x-mcp-header'];
        if (annotation === undefined || annotation === false) continue;
        const headerName =
          typeof annotation === 'string' && annotation.length > 0
            ? headerNameForParam(annotation)
            : headerNameForParam(prop);
        mappings.push({ property: prop, header: headerName });
      }
      if (mappings.length > 0) this.headerParams.set(name, mappings);
      else this.headerParams.delete(name);
    }
  }

  private transformError(error: JsonRpcFailure): JsonRpcFailure {
    const code = error.error.code;
    if (
      code === ErrorCodes.HeaderMismatch ||
      code === ErrorCodes.MissingRequiredClientCapability ||
      code === ErrorCodes.UnsupportedProtocolVersion
    ) {
      // Never leak 2026-only codes to a 2025 client.
      return makeError(error.id, ErrorCodes.InvalidRequest, error.error.message, {
        upstreamCode: code,
        upstreamData: error.error.data,
      });
    }
    return error;
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method === 'GET') {
        this.handleGet(req, res);
        return;
      }
      if (req.method === 'DELETE') {
        this.handleDelete(req, res);
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, makeError(null, ErrorCodes.InvalidRequest, 'Method not allowed'), {
          allow: 'GET, POST, DELETE',
        });
        return;
      }
      await this.handlePost(req, res);
    } catch (err) {
      this.options.logger.error(`legacy-front: ${(err as Error).message}`);
      if (!res.headersSent) {
        sendJson(res, 500, makeError(null, ErrorCodes.InternalError, (err as Error).message));
      } else {
        res.end();
      }
    }
  }

  private handleGet(req: http.IncomingMessage, res: http.ServerResponse): void {
    const session = this.sessions.get(String(req.headers[SESSION_HEADER] ?? ''));
    if (!session) {
      sendJson(res, 400, makeError(null, ErrorCodes.InvalidRequest, 'Missing or unknown Mcp-Session-Id'));
      return;
    }
    // Standalone SSE stream. The 2026 upstream has no GET stream to bridge
    // (subscriptions/listen fan-out is on the roadmap), so this stream only
    // carries keep-alives.
    startSse(res, { [SESSION_HEADER]: session.id });
    res.write(sseComment('mcp-shift legacy-front standalone stream'));
    const timer = setInterval(() => {
      res.write(sseComment('keep-alive'));
    }, 15000);
    timer.unref?.();
    req.on('close', () => clearInterval(timer));
  }

  private handleDelete(req: http.IncomingMessage, res: http.ServerResponse): void {
    const id = String(req.headers[SESSION_HEADER] ?? '');
    if (!this.sessions.delete(id)) {
      sendJson(res, 404, makeError(null, ErrorCodes.InvalidRequest, 'Unknown session'));
      return;
    }
    // 2025-era session termination is proxy-local: the 2026 upstream is stateless.
    sendEmpty(res, 200);
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
    if (Array.isArray(message)) {
      sendJson(
        res,
        400,
        makeError(null, ErrorCodes.InvalidRequest, 'JSON-RPC batching was removed in 2025-06-18'),
      );
      return;
    }

    // JSON-RPC *responses* from the client answer bridged server→client requests (MRTR legs).
    if (isResponse(message)) {
      const pending = this.pendingServerRequests.get(String(message.id));
      if (pending) {
        this.pendingServerRequests.delete(String(message.id));
        pending.resolve(message);
        sendEmpty(res, 202);
      } else {
        sendJson(res, 400, makeError(null, ErrorCodes.InvalidRequest, 'No matching server request'));
      }
      return;
    }

    if (isRequest(message) && message.method === 'initialize') {
      await this.handleInitialize(message, res);
      return;
    }

    const sessionId = String(req.headers[SESSION_HEADER] ?? '');
    const session = this.sessions.get(sessionId);
    if (!session) {
      // Per 2025-era Streamable HTTP: missing session → 400, expired/unknown → 404.
      const status = sessionId ? 404 : 400;
      sendJson(
        res,
        status,
        makeError(
          isRequest(message) ? message.id : null,
          ErrorCodes.InvalidRequest,
          sessionId ? 'Session not found' : 'Missing Mcp-Session-Id header',
        ),
      );
      return;
    }

    if (isRequest(message)) {
      switch (message.method) {
        case 'ping':
          // Removed upstream (SEP-2575) — answer locally.
          sendJson(res, 200, makeResult(message.id, {}), { [SESSION_HEADER]: session.id });
          return;
        case 'logging/setLevel': {
          // Removed upstream — becomes per-request _meta logLevel on every forwarded request.
          const level = (message.params as Record<string, unknown> | undefined)?.['level'];
          if (typeof level === 'string') session.logLevel = level;
          sendJson(res, 200, makeResult(message.id, {}), { [SESSION_HEADER]: session.id });
          return;
        }
        default:
          await this.forward(message, session, res);
          return;
      }
    }

    if (isNotification(message)) {
      await this.handleNotification(message, session, res);
      return;
    }
    sendJson(res, 400, makeError(null, ErrorCodes.InvalidRequest, 'Not a JSON-RPC message'));
  }

  private async handleInitialize(message: JsonRpcRequest, res: http.ServerResponse): Promise<void> {
    const params = (message.params ?? {}) as Record<string, unknown>;
    let discovered: Record<string, unknown>;
    try {
      discovered = await this.discover();
    } catch (err) {
      sendJson(res, 502, makeError(message.id, ErrorCodes.InternalError, (err as Error).message));
      return;
    }
    const session: Session = {
      id: crypto.randomUUID(),
      clientInfo: params['clientInfo'] as Record<string, unknown> | undefined,
      clientCapabilities: params['capabilities'] as Record<string, unknown> | undefined,
      negotiatedVersion: this.negotiateVersion(params['protocolVersion']),
    };
    this.sessions.set(session.id, session);
    const result: Record<string, unknown> = {
      protocolVersion: session.negotiatedVersion,
      capabilities: (discovered['capabilities'] as Record<string, unknown> | undefined) ?? {},
      serverInfo:
        (discovered['serverInfo'] as Record<string, unknown> | undefined) ??
        (discovered['identity'] as Record<string, unknown> | undefined) ?? {
          name: 'mcp-shift-proxied-server',
          version: '0.0.0',
        },
    };
    if (typeof discovered['instructions'] === 'string') {
      result['instructions'] = discovered['instructions'];
    }
    this.options.logger.info(
      `legacy-front: initialized session ${session.id} (negotiated ${session.negotiatedVersion})`,
    );
    sendJson(res, 200, makeResult(message.id, result), { [SESSION_HEADER]: session.id });
  }

  private async handleNotification(
    message: JsonRpcMessage & { method: string },
    session: Session,
    res: http.ServerResponse,
  ): Promise<void> {
    if (message.method === 'notifications/initialized') {
      sendEmpty(res, 202, { [SESSION_HEADER]: session.id });
      return;
    }
    if (message.method === 'notifications/cancelled') {
      // 2026-07-28 cancellation = closing the request's SSE response stream.
      const requestId = (message as { params?: { requestId?: unknown } }).params?.requestId;
      const controller = this.inflight.get(String(requestId));
      if (controller) controller.abort();
      sendEmpty(res, 202, { [SESSION_HEADER]: session.id });
      return;
    }
    // Forward other notifications (e.g. notifications/progress) with the envelope stamped.
    const stamped = injectEnvelope(message, this.sessionIdentity(session));
    try {
      await postUpstream(this.options.upstreamUrl, stamped, this.modernHeaders(stamped));
    } catch (err) {
      this.options.logger.warn(`legacy-front: notification forward failed: ${(err as Error).message}`);
    }
    sendEmpty(res, 202, { [SESSION_HEADER]: session.id });
  }

  private sessionIdentity(session: Session): EnvelopeIdentity {
    const identity: EnvelopeIdentity = {
      clientInfo: session.clientInfo ?? this.identity.clientInfo,
      clientCapabilities: session.clientCapabilities ?? {},
    };
    if (session.logLevel !== undefined) identity.logLevel = session.logLevel;
    return identity;
  }

  private async forward(
    message: JsonRpcRequest,
    session: Session,
    res: http.ServerResponse,
  ): Promise<void> {
    const stamped = injectEnvelope(message, this.sessionIdentity(session)) as JsonRpcRequest;
    const controller = new AbortController();
    this.inflight.set(String(message.id), controller);
    let upstream;
    try {
      upstream = await postUpstream(
        this.options.upstreamUrl,
        stamped,
        this.modernHeaders(stamped),
        controller.signal,
      );
    } catch (err) {
      this.inflight.delete(String(message.id));
      if (controller.signal.aborted) {
        sendEmpty(res, 202);
        return;
      }
      sendJson(res, 502, makeError(message.id, ErrorCodes.InternalError, (err as Error).message));
      return;
    }
    this.inflight.delete(String(message.id));

    if (upstream.kind === 'sse') {
      // Stream through, translating each event's payload.
      startSse(res, { [SESSION_HEADER]: session.id });
      const parser = new SseParser();
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
            let payload: JsonRpcMessage | undefined;
            try {
              payload = JSON.parse(event.data) as JsonRpcMessage;
            } catch {
              payload = undefined;
            }
            if (payload && isSuccess(payload)) {
              if (
                payload.result['resultType'] === 'input_required' &&
                String(payload.id) === String(message.id)
              ) {
                // The 2026 transport lets the upstream answer any request via
                // a per-request SSE body. An `input_required` final result
                // must be bridged exactly like the JSON-bodied case — never
                // stripped and forwarded as if it were a completed result.
                try {
                  await reader.cancel();
                } catch {
                  // The upstream response is finished with either way.
                }
                await this.runMrtrRounds(message, payload, session, res);
                return;
              }
              if (message.method === 'tools/list') this.recordHeaderParams(payload.result);
              const transformed = makeResult(payload.id, stripModernResultFields(payload.result));
              res.write(serializeSseEvent({ event: 'message', data: JSON.stringify(transformed) }));
            } else if (payload && isResponse(payload)) {
              res.write(
                serializeSseEvent({
                  event: 'message',
                  data: JSON.stringify(this.transformError(payload as JsonRpcFailure)),
                }),
              );
            } else if (payload) {
              res.write(serializeSseEvent({ event: 'message', data: JSON.stringify(payload) }));
            }
          }
        }
      } catch {
        // Upstream stream broke: 2026 has no redelivery — the client must re-issue.
      }
      res.end();
      return;
    }

    if (upstream.kind === 'empty') {
      sendEmpty(res, upstream.status, { [SESSION_HEADER]: session.id });
      return;
    }

    const upstreamMessage = upstream.message;
    if (!upstreamMessage || !isResponse(upstreamMessage)) {
      sendJson(
        res,
        502,
        makeError(message.id, ErrorCodes.InternalError, 'Upstream returned an unexpected payload'),
      );
      return;
    }
    if (!isSuccess(upstreamMessage)) {
      sendJson(res, 200, this.transformError(upstreamMessage as JsonRpcFailure), {
        [SESSION_HEADER]: session.id,
      });
      return;
    }

    if (upstreamMessage.result['resultType'] === 'input_required') {
      await this.bridgeMrtr(message, upstreamMessage, session, res);
      return;
    }

    if (message.method === 'tools/list') {
      this.recordHeaderParams(upstreamMessage.result);
    }
    sendJson(
      res,
      200,
      makeResult(message.id, stripModernResultFields(upstreamMessage.result)),
      { [SESSION_HEADER]: session.id },
    );
  }

  /**
   * MRTR bridging (SEP-2322): the 2026 server answered `input_required`.
   * Translate each embedded input request into a real 2025 server→client
   * JSON-RPC request on this POST's SSE response stream, collect the client's
   * responses, then retry the original request upstream with `inputResponses`
   * and a byte-exact `requestState` echo — repeating until `complete`.
   */
  private async bridgeMrtr(
    original: JsonRpcRequest,
    firstResult: JsonRpcSuccess,
    session: Session,
    res: http.ServerResponse,
  ): Promise<void> {
    startSse(res, { [SESSION_HEADER]: session.id });
    await this.runMrtrRounds(original, firstResult, session, res);
  }

  /** The MRTR round loop, assuming `res` is already an open SSE stream. */
  private async runMrtrRounds(
    original: JsonRpcRequest,
    firstResult: JsonRpcSuccess,
    session: Session,
    res: http.ServerResponse,
  ): Promise<void> {
    let current = firstResult;
    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    for (let round = 0; round < MRTR_MAX_ROUNDS; round++) {
      const result = current.result;
      if (result['resultType'] !== 'input_required') {
        res.write(
          serializeSseEvent({
            event: 'message',
            data: JSON.stringify(makeResult(original.id, stripModernResultFields(result))),
          }),
        );
        res.end();
        return;
      }
      const inputRequests = (result['inputRequests'] ?? {}) as Record<string, Record<string, unknown>>;
      const requestState = result['requestState'];
      const responses: Record<string, unknown> = {};

      const legs = Object.entries(inputRequests).map(async ([key, spec]) => {
        const { method, params } = this.toServerRequest(spec);
        const serverRequestId = `mcp-shift-sr-${++this.serverRequestCounter}`;
        const promise = new Promise<JsonRpcMessage>((resolve, reject) => {
          this.pendingServerRequests.set(serverRequestId, { resolve, reject });
          const timer = setTimeout(() => {
            this.pendingServerRequests.delete(serverRequestId);
            reject(new Error(`Timed out waiting for client response to ${method}`));
          }, this.options.mrtrTimeoutMs ?? 30000);
          timer.unref?.();
        });
        res.write(
          serializeSseEvent({
            event: 'message',
            data: JSON.stringify({ jsonrpc: '2.0', id: serverRequestId, method, params }),
          }),
        );
        const response = await promise;
        if (isSuccess(response)) {
          responses[key] = response.result;
        } else if (method === 'elicitation/create') {
          // A client-side error on an elicitation leg maps to a decline,
          // which is a valid ElicitResult.
          responses[key] = { action: 'decline' };
        } else {
          // CreateMessageResult / ListRootsResult have no decline shape:
          // fail the bridged request explicitly instead of sending an
          // invalid substitute upstream (explicit degradation over silent
          // corruption).
          const failure = response as JsonRpcFailure;
          throw new Error(
            `Client answered bridged ${method} with an error ` +
              `(${failure.error.code}: ${failure.error.message}); ` +
              `no valid substitute result exists for this request type`,
          );
        }
      });

      try {
        await Promise.all(legs);
      } catch (err) {
        res.write(
          serializeSseEvent({
            event: 'message',
            data: JSON.stringify(
              makeError(original.id, ErrorCodes.InternalError, (err as Error).message),
            ),
          }),
        );
        res.end();
        return;
      }
      if (closed) return;

      // Retry the ORIGINAL request with a fresh id, inputResponses, and the
      // requestState echoed byte-exactly (SEP-2322).
      const retry: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: `${String(original.id)}-mrtr-${round + 1}`,
        method: original.method,
        params: {
          ...(original.params ?? {}),
          inputResponses: responses,
          requestState,
        },
      };
      const stamped = injectEnvelope(retry, this.sessionIdentity(session)) as JsonRpcRequest;
      const upstream = await postUpstream(
        this.options.upstreamUrl,
        stamped,
        this.modernHeaders(stamped),
      );
      if (upstream.kind !== 'json' || !upstream.message || !isResponse(upstream.message)) {
        res.write(
          serializeSseEvent({
            event: 'message',
            data: JSON.stringify(
              makeError(original.id, ErrorCodes.InternalError, 'MRTR retry failed upstream'),
            ),
          }),
        );
        res.end();
        return;
      }
      if (!isSuccess(upstream.message)) {
        res.write(
          serializeSseEvent({
            event: 'message',
            data: JSON.stringify(this.transformError(upstream.message as JsonRpcFailure)),
          }),
        );
        res.end();
        return;
      }
      current = upstream.message;
    }
    res.write(
      serializeSseEvent({
        event: 'message',
        data: JSON.stringify(
          makeError(original.id, ErrorCodes.InternalError, 'MRTR round limit exceeded'),
        ),
      }),
    );
    res.end();
  }

  /**
   * Map a 2026 `inputRequests` entry to a 2025 server→client request.
   *
   * Per `schema/draft/schema.json`, `InputRequests` values are JSON-RPC
   * request objects — `anyOf CreateMessageRequest | ListRootsRequest |
   * ElicitRequest`, i.e. `{ method: 'sampling/createMessage' | 'roots/list' |
   * 'elicitation/create', params?: {...} }` (`params` is optional only for
   * `roots/list`). These are exactly the three server→client request shapes
   * that already existed in 2025, so they forward essentially as-is. Anything
   * else cannot be bridged: fail the leg explicitly rather than misroute it.
   */
  private toServerRequest(spec: Record<string, unknown>): {
    method: string;
    params: Record<string, unknown>;
  } {
    const method = spec['method'];
    if (
      method === 'sampling/createMessage' ||
      method === 'roots/list' ||
      method === 'elicitation/create'
    ) {
      return { method, params: (spec['params'] as Record<string, unknown> | undefined) ?? {} };
    }
    throw new Error(
      `Unbridgeable inputRequests entry (method ${JSON.stringify(method ?? null)}): ` +
        `expected 'sampling/createMessage', 'roots/list', or 'elicitation/create' ` +
        `(InputRequest, schema/draft/schema.json)`,
    );
  }
}
