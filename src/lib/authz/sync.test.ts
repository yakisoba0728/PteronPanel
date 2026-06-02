import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const prismaMock = vi.hoisted(() => ({
  serverAccess: {
    upsert: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { syncServerAccess } from './sync';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncServerAccess', () => {
  it('records a SUBUSER link per (subuser, server) and prunes stale rows', async () => {
    const now = new Date('2026-06-02T10:00:00.000Z');
    mswServer.use(
      http.get(`${CLIENT}/`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                identifier: '1a2b3c4d',
                uuid: '1a2b3c4d-0000-4000-8000-000000000000',
                name: 'Alpha',
              },
            },
          ],
          meta: {
            pagination: {
              total: 1,
              count: 1,
              per_page: 100,
              current_page: 1,
              total_pages: 1,
            },
          },
        }),
      ),
      http.get(`${CLIENT}/servers/1a2b3c4d/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server_subuser',
              attributes: {
                uuid: 'sub-1',
                username: 'b',
                email: 'b@x.com',
                image: '',
                permissions: ['control.console'],
              },
            },
          ],
        }),
      ),
    );

    const result = await syncServerAccess(now);

    expect(result.servers).toBe(1);
    expect(result.subuserLinks).toBe(1);
    expect(prismaMock.serverAccess.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pteroUuid_serverIdentifier: {
            pteroUuid: 'sub-1',
            serverIdentifier: '1a2b3c4d',
          },
        },
        update: expect.objectContaining({
          syncedAt: now,
          serverName: 'Alpha',
          permissions: ['control.console'],
        }),
        create: expect.objectContaining({
          pteroUuid: 'sub-1',
          serverIdentifier: '1a2b3c4d',
          serverUuid: '1a2b3c4d-0000-4000-8000-000000000000',
          serverName: 'Alpha',
          permissions: ['control.console'],
          syncedAt: now,
        }),
      }),
    );
    expect(prismaMock.serverAccess.deleteMany).toHaveBeenCalledWith({
      where: { syncedAt: { lt: now } },
    });
  });
});
