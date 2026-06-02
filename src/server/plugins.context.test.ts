import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, requireUserMock } = vi.hoisted(() => ({
  prismaMock: { plugin: { findFirst: vi.fn() } },
  requireUserMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth/current-user', () => ({ requireUser: requireUserMock }));

import { verifyContextToken } from '@/lib/plugins/context-token';
import { getPluginContextAction } from './plugins';

beforeEach(() => {
  requireUserMock.mockResolvedValue({ id: 'u1', role: 'USER', pteroUserId: 7 });
  vi.clearAllMocks();
});

describe('getPluginContextAction', () => {
  it('issues a context token for an owned plugin', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({
      id: 'pl1',
      ownerId: 'u1',
      uiTabUrl: 'https://ui',
    });

    const r = await getPluginContextAction('pl1');

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(verifyContextToken(r.token)).toEqual({ pluginId: 'pl1', ownerId: 'u1' });
    }
  });

  it('refuses a plugin not owned by the caller', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue(null);

    expect(await getPluginContextAction('plX')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
