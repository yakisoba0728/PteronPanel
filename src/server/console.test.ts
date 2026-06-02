import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asIdentifier, asNumericId, asUuid } from '@/lib/ptero/types';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveAccessibleServers: vi.fn(),
  getWebsocketCredentials: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/auth/current-user', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers: mocks.resolveAccessibleServers,
}));
vi.mock('@/lib/ptero/client', () => ({
  getWebsocketCredentials: mocks.getWebsocketCredentials,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

async function loadAction() {
  return import('./console');
}

describe('getConsoleCredentials', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: 'user-1',
      email: 'u@example.com',
      username: 'u',
      passwordHash: 'x',
      role: 'USER',
      pteroUserId: 7,
      pteroUuid: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('returns websocket credentials for an accessible server', async () => {
    const { getConsoleCredentials } = await loadAction();
    mocks.resolveAccessibleServers.mockResolvedValue([
      {
        identifier: asIdentifier('1a2b3c4d'),
        uuid: asUuid('1a2b3c4d-0000-4000-8000-000000000000'),
        numericId: asNumericId(12),
        name: 'A',
      },
    ]);
    mocks.getWebsocketCredentials.mockResolvedValue({
      token: 'jwt',
      socket: 'wss://node/ws',
    });

    await expect(getConsoleCredentials('1a2b3c4d')).resolves.toEqual({
      token: 'jwt',
      socket: 'wss://node/ws',
    });
  });

  it('maps out-of-scope access to notFound', async () => {
    const { getConsoleCredentials } = await loadAction();
    mocks.resolveAccessibleServers.mockResolvedValue([]);

    await getConsoleCredentials('1a2b3c4d').catch(() => undefined);
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getWebsocketCredentials).not.toHaveBeenCalled();
  });
});
