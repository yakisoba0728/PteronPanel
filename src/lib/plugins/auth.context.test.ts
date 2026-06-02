import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    plugin: { findUnique: vi.fn(), findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { authenticatePlugin } from './auth';
import { generateContextToken } from './context-token';

beforeEach(() => vi.clearAllMocks());

const req = (auth: string) =>
  new Request('https://x/api/ext/servers', { headers: { authorization: auth } });

describe('authenticatePlugin with context token', () => {
  it('accepts a valid ptxc_ token for an enabled plugin', async () => {
    const t = generateContextToken('pl1', 'u1', 60_000);
    prismaMock.plugin.findUnique.mockResolvedValue({
      id: 'pl1',
      ownerId: 'u1',
      enabled: true,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'USER',
      pteroUserId: 7,
      isActive: true,
    });

    const ctx = await authenticatePlugin(req(`Bearer ${t}`));

    expect(ctx?.owner.id).toBe('u1');
    expect(ctx?.pluginId).toBe('pl1');
  });

  it('rejects ptxc_ whose pluginId/ownerId mismatch DB', async () => {
    const t = generateContextToken('pl1', 'uX', 60_000);
    prismaMock.plugin.findUnique.mockResolvedValue({
      id: 'pl1',
      ownerId: 'u1',
      enabled: true,
    });

    expect(await authenticatePlugin(req(`Bearer ${t}`))).toBeNull();
  });
});
