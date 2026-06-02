import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    plugin: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }));

import { authenticatePlugin } from './auth';
import { hashPluginToken } from './token';

beforeEach(() => vi.clearAllMocks());

function req(auth?: string) {
  return new Request('https://x/api/ext/servers', {
    headers: auth ? { authorization: auth } : {},
  });
}

describe('authenticatePlugin', () => {
  it('returns null without a Bearer ptex_ token', async () => {
    expect(await authenticatePlugin(req())).toBeNull();
    expect(await authenticatePlugin(req('Bearer nope'))).toBeNull();
  });

  it('resolves an enabled plugin + owner', async () => {
    const token = 'ptex_' + 'a'.repeat(43);
    mocks.prisma.plugin.findUnique.mockResolvedValue({
      id: 'pl1',
      ownerId: 'u1',
      enabled: true,
    });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'USER',
      pteroUserId: 7,
      isActive: true,
    });

    const ctx = await authenticatePlugin(req(`Bearer ${token}`));

    expect(mocks.prisma.plugin.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashPluginToken(token) } }),
    );
    expect(ctx?.owner.id).toBe('u1');
  });

  it('rejects a disabled plugin', async () => {
    mocks.prisma.plugin.findUnique.mockResolvedValue({
      id: 'pl1',
      ownerId: 'u1',
      enabled: false,
    });

    expect(await authenticatePlugin(req('Bearer ptex_' + 'b'.repeat(43)))).toBeNull();
  });
});
