import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asIdentifier, asUuid } from '@/lib/ptero/types';

const { requireUser, resolveAccessibleServers, getServer, powerServer, audit } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    resolveAccessibleServers: vi.fn(),
    getServer: vi.fn(),
    powerServer: vi.fn(),
    audit: vi.fn(),
  }),
);

vi.mock('@/lib/auth/current-user', () => ({
  requireUser,
}));

vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers,
}));

vi.mock('@/lib/ptero/client', () => ({
  getServer,
  powerServer,
}));

vi.mock('@/lib/audit', () => ({
  audit,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getServerOverview', () => {
  it('returns the scoped server and raw attributes', async () => {
    const { getServerOverview } = await import('./servers');

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
    resolveAccessibleServers.mockResolvedValue([
      {
        identifier: asIdentifier('1a2b3c4d'),
        uuid: asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef'),
        name: 'Alpha',
      },
    ]);
    getServer.mockResolvedValue({
      object: 'server',
      attributes: {
        name: 'Alpha',
        limits: { memory: 1024, disk: 2048, cpu: 50 },
      },
    });

    await expect(getServerOverview('1a2b3c4d')).resolves.toMatchObject({
      server: {
        identifier: asIdentifier('1a2b3c4d'),
        name: 'Alpha',
      },
      attributes: {
        name: 'Alpha',
        limits: { memory: 1024, disk: 2048, cpu: 50 },
      },
    });
    expect(getServer).toHaveBeenCalledWith(asIdentifier('1a2b3c4d'));
  });
});

describe('powerServerAction', () => {
  it('returns not_found when the user cannot access the server', async () => {
    const { powerServerAction } = await import('./servers');

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
    resolveAccessibleServers.mockResolvedValue([]);

    await expect(powerServerAction('1a2b3c4d', 'restart')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(powerServer).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('powers the scoped server and audits the action', async () => {
    const { powerServerAction } = await import('./servers');

    requireUser.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
      pteroUserId: 7,
    });
    resolveAccessibleServers.mockResolvedValue([
      {
        identifier: asIdentifier('1a2b3c4d'),
        uuid: asUuid('1a2b3c4d-5e6f-7081-9234-567890abcdef'),
        name: 'Alpha',
      },
    ]);
    powerServer.mockResolvedValue(undefined);
    audit.mockResolvedValue(undefined);

    await expect(powerServerAction('1a2b3c4d', 'restart')).resolves.toEqual({ ok: true });
    expect(powerServer).toHaveBeenCalledWith(asIdentifier('1a2b3c4d'), 'restart');
    expect(audit).toHaveBeenCalledWith(
      'server.power',
      expect.objectContaining({
        userId: 'user-1',
        target: asIdentifier('1a2b3c4d'),
        metadata: { signal: 'restart' },
      }),
    );
  });
});
