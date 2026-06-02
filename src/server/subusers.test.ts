import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

const { audit } = vi.hoisted(() => ({
  audit: vi.fn(),
}));
const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(async () => [{ id: 'local-subuser' }]),
  },
  serverAccess: {
    upsert: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  },
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    role: 'ADMIN',
    pteroUserId: null,
  })),
}));

vi.mock('@/lib/audit', () => ({ audit }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import {
  listSubusersAction,
  createSubuserAction,
  updateSubuserAction,
  deleteSubuserAction,
  getPermissionsAction,
} from './subusers';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

function adminLists(identifier: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [
          {
            object: 'server',
            attributes: {
              identifier,
              uuid: `${identifier}-0000-4000-8000-000000000000`,
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

describe('subuser actions', () => {
  it('lists subusers for accessible server', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(
      http.get(`${CLIENT}/servers/1a2b3c4d/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server_subuser',
              attributes: {
                uuid: 's1',
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
    const res = await listSubusersAction('1a2b3c4d');
    expect(res.ok && res.subusers[0].uuid).toBe('s1');
  });

  it('returns not_found for inaccessible list', async () => {
    adminLists('1a2b3c4d');
    expect(await listSubusersAction('deadbeef')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('guards mutation and permission actions before ptero calls', async () => {
    adminLists('1a2b3c4d');

    await expect(getPermissionsAction('deadbeef')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(
      createSubuserAction('deadbeef', 'not-an-email', ['control.console']),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(
      updateSubuserAction('deadbeef', 'sub-uuid', ['control.console']),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    await expect(deleteSubuserAction('deadbeef', 'sub-uuid')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('createSubuser validates email', async () => {
    adminLists('1a2b3c4d');
    const res = await createSubuserAction('1a2b3c4d', 'not-an-email', [
      'control.console',
    ]);
    expect(res.ok).toBe(false);
  });

  it('deleteSubuser removes the ServerAccess cache row immediately', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(
      http.delete(`${CLIENT}/servers/1a2b3c4d/users/sub-uuid`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    await expect(deleteSubuserAction('1a2b3c4d', 'sub-uuid')).resolves.toEqual({
      ok: true,
    });
    expect(prismaMock.serverAccess.deleteMany).toHaveBeenCalledWith({
      where: { pteroUuid: 'sub-uuid', serverIdentifier: '1a2b3c4d' },
    });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { pteroUuid: 'sub-uuid' },
      select: { id: true },
    });
  });
});
