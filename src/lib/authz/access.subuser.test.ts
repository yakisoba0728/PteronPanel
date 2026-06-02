import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(async () => ({ pteroUuid: 'user-uuid-7' })),
  },
  serverAccess: {
    findMany: vi.fn(async () => [
      {
        serverIdentifier: 'bbbbbbbb',
        serverUuid: 'bbbbbbbb-0000-4000-8000-000000000000',
        serverName: 'Shared',
        permissions: ['control.console'],
      },
    ]),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { resolveAccessibleServers, invalidateAccessCache } from './access';

const APP = 'https://panel.test/api/application';

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({
    pteroUuid: 'user-uuid-7',
  });
  prismaMock.serverAccess.findMany.mockResolvedValue([
    {
      serverIdentifier: 'bbbbbbbb',
      serverUuid: 'bbbbbbbb-0000-4000-8000-000000000000',
      serverName: 'Shared',
      permissions: ['control.console'],
    },
  ]);
});

function ownedResponse(identifier = 'aaaaaaaa') {
  return HttpResponse.json({
    object: 'user',
    attributes: {
      id: 7,
      relationships: {
        servers: {
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                id: 1,
                identifier,
                uuid: `${identifier}-0000-4000-8000-000000000000`,
                name: 'Owned',
              },
            },
          ],
        },
      },
    },
  });
}

describe('resolveAccessibleServers with subuser scope', () => {
  it('USER sees owned + subuser servers (deduped)', async () => {
    mswServer.use(http.get(`${APP}/users/7`, () => ownedResponse()));

    const out = await resolveAccessibleServers({
      id: 'u-7',
      role: 'USER',
      pteroUserId: 7,
    });

    expect(out.map((server) => server.identifier).sort()).toEqual([
      'aaaaaaaa',
      'bbbbbbbb',
    ]);
    expect(out.find((server) => server.identifier === 'bbbbbbbb')).toMatchObject({
      accessKind: 'subuser',
      permissions: ['control.console'],
    });
  });

  it('does not duplicate a server that is both owned and a subuser row', async () => {
    prismaMock.serverAccess.findMany.mockResolvedValue([
      {
        serverIdentifier: 'aaaaaaaa',
        serverUuid: 'aaaaaaaa-0000-4000-8000-000000000000',
        serverName: 'Owned',
        permissions: ['control.console'],
      },
    ]);
    mswServer.use(http.get(`${APP}/users/7`, () => ownedResponse()));

    const out = await resolveAccessibleServers({
      id: 'u-7',
      role: 'USER',
      pteroUserId: 7,
    });

    expect(out.map((server) => server.identifier)).toEqual(['aaaaaaaa']);
  });
});
