import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { plugin: { findFirst: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { getEnabledPluginUiOrigin } from './frame-origin';

beforeEach(() => vi.clearAllMocks());

describe('getEnabledPluginUiOrigin', () => {
  it('returns the origin of an enabled plugin uiTabUrl', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'https://x.example/ui' });

    expect(await getEnabledPluginUiOrigin('pl1')).toBe('https://x.example');
    expect(prismaMock.plugin.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pl1', enabled: true, uiTabUrl: { not: null } },
      }),
    );
  });

  it('preserves host and port (e.g. loopback plugin UIs)', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'http://127.0.0.1:45199/plugin-ui' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBe('http://127.0.0.1:45199');
  });

  it('returns null when no plugin matches', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue(null);
    expect(await getEnabledPluginUiOrigin('missing')).toBeNull();
  });

  it('returns null when the stored URL cannot be parsed', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'not a url' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBeNull();
  });

  it('rejects origins carrying CSP-significant characters', async () => {
    // A wildcard host would widen frame-src to any subdomain.
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'https://*.evil.com' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBeNull();

    // A ';' would terminate frame-src and could inject another directive.
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'https://a.com;x' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBeNull();
  });

  it('rejects non-http(s) schemes whose origin is opaque', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'javascript:alert(1)' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBeNull();
  });
});
