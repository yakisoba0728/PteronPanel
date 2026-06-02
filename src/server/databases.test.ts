import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

const { audit } = vi.hoisted(() => ({
  audit: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    role: 'ADMIN',
    pteroUserId: null,
  })),
}));

vi.mock('@/lib/audit', () => ({
  audit,
}));

import { listDatabasesAction } from './databases';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

function adminLists(idf: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [
          {
            object: 'server',
            attributes: {
              identifier: idf,
              uuid: `${idf}-0000-4000-8000-000000000000`,
              name: 'S',
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
  );
}

describe('listDatabasesAction', () => {
  it('returns databases for accessible server', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(
      http.get(`${CLIENT}/servers/1a2b3c4d/databases`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server_database',
              attributes: {
                id: 'H1',
                name: 'db',
                username: 'u',
                host: { address: 'h', port: 3306 },
                connections_from: '%',
                max_connections: 0,
              },
            },
          ],
        }),
      ),
    );
    const res = await listDatabasesAction('1a2b3c4d');
    expect(res.ok && res.databases[0].id).toBe('H1');
  });

  it('not_found for inaccessible', async () => {
    adminLists('1a2b3c4d');
    expect(await listDatabasesAction('deadbeef')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
