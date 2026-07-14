import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectEra } from '../src/detect.js';
import { startLegacyServer, type LegacyServerFixture } from './helpers/legacyServer.js';
import { startModernServer, type ModernServerFixture } from './helpers/modernServer.js';

let legacy: LegacyServerFixture;
let modern: ModernServerFixture;

beforeAll(async () => {
  legacy = await startLegacyServer();
  modern = await startModernServer();
});

afterAll(async () => {
  await legacy.close();
  await modern.close();
});

describe('detectEra (backward-compatibility probing)', () => {
  it('identifies a 2026-07-28 server via server/discover', async () => {
    const result = await detectEra(modern.url);
    expect(result.era).toBe('modern');
    expect(result.protocolVersions).toEqual(['2026-07-28']);
    expect(result.serverInfo).toEqual({ name: 'modern-fixture', version: '1.0.0' });
  });

  it('falls back to initialize and identifies a 2025-era server', async () => {
    const result = await detectEra(legacy.url);
    expect(result.era).toBe('legacy');
    expect(result.protocolVersions).toEqual(['2025-11-25']);
    expect(result.serverInfo).toEqual({ name: 'legacy-fixture', version: '1.0.0' });
    expect(result.detail).toContain('session-managed');
  });

  it('reports unknown for a non-MCP endpoint', async () => {
    const result = await detectEra('http://127.0.0.1:1/'); // nothing listens here
    expect(result.era).toBe('unknown');
  });
});
