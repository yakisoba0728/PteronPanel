import { describe, expect, it, vi } from 'vitest';
import { asIdentifier, asUuid } from '@/lib/ptero/types';
import type { AccessibleServer } from '@/lib/ptero/types';

const { requireUser, resolveAccessibleServers } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveAccessibleServers: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser,
}));

vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers,
}));

describe('listMyServers', () => {
  it('returns the scoped servers for the current user', async () => {
    const { listMyServers } = await import('./servers');
    const servers = [
      {
        identifier: asIdentifier('1a2b3c4d'),
        uuid: asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef'),
        name: 'Alpha',
      },
    ] satisfies AccessibleServer[];

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
    resolveAccessibleServers.mockResolvedValue(servers);

    await expect(listMyServers()).resolves.toEqual(servers);
    expect(resolveAccessibleServers).toHaveBeenCalledWith({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
  });
});
