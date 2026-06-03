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

  it('returns null when no plugin matches', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue(null);
    expect(await getEnabledPluginUiOrigin('missing')).toBeNull();
  });

  it('returns null when the stored URL cannot be parsed', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'not a url' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBeNull();
  });
});
