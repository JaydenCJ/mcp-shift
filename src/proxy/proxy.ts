import http from 'node:http';
import { detectEra } from '../detect.js';
import { LegacyFront } from './legacyFront.js';
import { ModernFront } from './modernFront.js';
import { silentLogger, type ProxyLogger } from './logger.js';

export type Front = '2025' | '2026';

export interface ProxyOptions {
  upstreamUrl: string;
  /**
   * Which era the proxy speaks to *clients*:
   * - `'2025'` → old clients, new (2026-07-28) upstream server
   * - `'2026'` → new clients, old (2025-era) upstream server
   * - `'auto'` → probe the upstream and pick the opposite era
   */
  front: Front | 'auto';
  logger?: ProxyLogger;
  mrtrTimeoutMs?: number;
}

export interface RunningProxy {
  server: http.Server;
  front: Front;
  url: string;
  close(): Promise<void>;
}

export async function resolveFront(options: ProxyOptions): Promise<Front> {
  if (options.front !== 'auto') return options.front;
  const detected = await detectEra(options.upstreamUrl);
  if (detected.era === 'modern') return '2025'; // modern upstream → serve old clients
  if (detected.era === 'legacy') return '2026'; // legacy upstream → serve new clients
  throw new Error(
    `Could not auto-detect the upstream era (${detected.detail}). Pass --front 2025 or --front 2026 explicitly.`,
  );
}

export async function startProxy(
  options: ProxyOptions,
  port = 0,
  host = '127.0.0.1',
): Promise<RunningProxy> {
  const logger = options.logger ?? silentLogger;
  const front = await resolveFront(options);
  const handler =
    front === '2025'
      ? new LegacyFront({
          upstreamUrl: options.upstreamUrl,
          logger,
          ...(options.mrtrTimeoutMs !== undefined ? { mrtrTimeoutMs: options.mrtrTimeoutMs } : {}),
        })
      : new ModernFront({ upstreamUrl: options.upstreamUrl, logger });

  const server = http.createServer((req, res) => {
    void handler.handle(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    front,
    url: `http://${host}:${actualPort}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
