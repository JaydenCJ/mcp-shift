export interface ProxyLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function consoleLogger(prefix = 'mcp-shift'): ProxyLogger {
  return {
    info: (m) => console.error(`[${prefix}] ${m}`),
    warn: (m) => console.error(`[${prefix}] warn: ${m}`),
    error: (m) => console.error(`[${prefix}] error: ${m}`),
  };
}

export const silentLogger: ProxyLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
