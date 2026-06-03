import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asIdentifier, asUuid } from '@/lib/ptero/types';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveAccessibleServers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/auth/current-user', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers: mocks.resolveAccessibleServers,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

async function loadAction() {
  return import('./console');
}

describe('getConsoleAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
      pteroUuid: null,
    });
  });

  it('returns the access kind and permissions for an accessible server', async () => {
    const { getConsoleAccess } = await loadAction();
    mocks.resolveAccessibleServers.mockResolvedValue([
      {
        identifier: asIdentifier('1a2b3c4d'),
        uuid: asUuid('1a2b3c4d-0000-4000-8000-000000000000'),
        name: 'A',
        accessKind: 'subuser',
        permissions: ['control.console'],
      },
    ]);

    await expect(getConsoleAccess('1a2b3c4d')).resolves.toEqual({
      accessKind: 'subuser',
      permissions: ['control.console'],
    });
  });

  it('maps out-of-scope access to notFound', async () => {
    const { getConsoleAccess } = await loadAction();
    mocks.resolveAccessibleServers.mockResolvedValue([]);

    await getConsoleAccess('1a2b3c4d').catch(() => undefined);
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
