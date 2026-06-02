import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { plugin: { findMany: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { ownerPluginTabs } from './owner-tabs';

beforeEach(() => vi.clearAllMocks());

describe('ownerPluginTabs', () => {
  it('returns enabled plugins with a uiTabUrl as tab descriptors', async () => {
    prismaMock.plugin.findMany.mockResolvedValue([
      { id: 'pl1', uiTabLabel: 'My Tab', uiTabUrl: 'https://ui', enabled: true },
      { id: 'pl2', uiTabLabel: null, uiTabUrl: null, enabled: true },
    ]);

    const tabs = await ownerPluginTabs('u1', '1a2b3c4d');

    expect(prismaMock.plugin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: 'u1', enabled: true, uiTabUrl: { not: null } },
      }),
    );
    expect(tabs).toEqual([
      { key: 'plugin:pl1', label: 'My Tab', href: '/servers/1a2b3c4d/plugin/pl1' },
    ]);
  });
});
