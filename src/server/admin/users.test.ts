import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { Prisma, type User } from '@prisma/client';

type CurrentUser = Pick<User, 'id' | 'role' | 'pteroUserId'>;
type UserData = Record<string, unknown>;
type UserLookup = {
  id?: string;
  role?: 'ADMIN' | 'USER';
  isActive?: boolean;
  pteroUserId?: number | null;
};

const { prismaMock, userState } = vi.hoisted(() => ({
  userState: {
    currentUser: {
      id: 'admin',
      role: 'ADMIN',
      pteroUserId: null,
    } as CurrentUser,
  },
  prismaMock: {
  user: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async (): Promise<UserLookup | null> => null),
    count: vi.fn(async () => 2),
    create: vi.fn(async ({ data }: { data: UserData }) => ({
      id: 'p1',
      ...data,
    })),
    update: vi.fn(async ({ data }: { data: UserData }) => ({
      id: 'p1',
      ...data,
    })),
    delete: vi.fn(async () => ({ id: 'p1' })),
  },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => userState.currentUser),
}));

import {
  createPteronUserAction,
  deletePteronUserAction,
  listPteronUsersAction,
  updatePteronUserAction,
} from './users';

const BASE = 'https://panel.test/api/application';

beforeEach(() => {
  userState.currentUser = { id: 'admin', role: 'ADMIN', pteroUserId: null };
  vi.clearAllMocks();
});

describe('admin user actions', () => {
  it('non-admin is rejected', async () => {
    userState.currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    const res = await listPteronUsersAction();
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('createPteronUser maps to a Pterodactyl user by email', async () => {
    mswServer.use(
      http.get(`${BASE}/users`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('filter[email]')).toBe(
          'bob@x.com',
        );
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'user',
              attributes: { id: 7, uuid: 'u-7', email: 'bob@x.com' },
            },
          ],
          meta: {
            pagination: {
              total: 1,
              count: 1,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        });
      }),
    );
    const res = await createPteronUserAction({
      email: 'bob@x.com',
      username: 'bob',
      password: 'pw12345678',
      role: 'USER',
    });
    expect(res.ok).toBe(true);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pteroUserId: 7,
          pteroUuid: 'u-7',
          role: 'USER',
        }),
      }),
    );
  });

  it('updatePteronUser blocks self-demotion', async () => {
    const res = await updatePteronUserAction({ id: 'admin', role: 'USER' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain('자기 자신');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('updatePteronUser blocks self-deactivation', async () => {
    const res = await updatePteronUserAction({
      id: 'admin',
      isActive: false,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain('자기 자신');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('updatePteronUser keeps at least one active admin', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'other-admin',
      role: 'ADMIN',
      isActive: true,
    });
    prismaMock.user.count.mockResolvedValueOnce(1);

    const res = await updatePteronUserAction({
      id: 'other-admin',
      role: 'USER',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain('활성 관리자');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('createPteronUser deletes created Pterodactyl user if local create fails', async () => {
    let deletedExternal = false;
    prismaMock.user.create.mockRejectedValueOnce(new Error('local create failed'));
    mswServer.use(
      http.get(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [],
          meta: {
            pagination: {
              total: 0,
              count: 0,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        }),
      ),
      http.post(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'user',
          attributes: {
            id: 8,
            uuid: 'u-8',
            username: 'new',
            email: 'new@example.com',
            first_name: 'New',
            last_name: 'User',
            root_admin: false,
            created_at: '',
          },
        }),
      ),
      http.delete(`${BASE}/users/8`, () => {
        deletedExternal = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await createPteronUserAction({
      email: 'new@example.com',
      username: 'new',
      password: 'pw12345678',
      role: 'USER',
      createPterodactyl: true,
    });

    expect(res.ok).toBe(false);
    expect(deletedExternal).toBe(true);
  });

  it('updatePteronUser with only an id is a no-op (no update, no audit)', async () => {
    const res = await updatePteronUserAction({ id: 'someone' });

    expect(res).toEqual({ ok: true });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('createPteronUser surfaces a clear message on duplicate email/mapping', async () => {
    prismaMock.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    mswServer.use(
      http.get(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [],
          meta: {
            pagination: {
              total: 0,
              count: 0,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        }),
      ),
    );

    const res = await createPteronUserAction({
      email: 'dup@example.com',
      username: 'dup',
      password: 'pw12345678',
      role: 'USER',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('failed');
      expect(res.detail).toContain('이미 사용 중인');
    }
  });

  it('createPteronUser surfaces orphaned Pterodactyl user when compensating delete fails', async () => {
    prismaMock.user.create.mockRejectedValueOnce(
      new Error('local create failed'),
    );
    mswServer.use(
      http.get(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [],
          meta: {
            pagination: {
              total: 0,
              count: 0,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        }),
      ),
      http.post(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'user',
          attributes: {
            id: 9,
            uuid: 'u-9',
            username: 'orphan',
            email: 'orphan@example.com',
            first_name: 'Orphan',
            last_name: 'User',
            root_admin: false,
            created_at: '',
          },
        }),
      ),
      http.delete(`${BASE}/users/9`, () =>
        HttpResponse.json(
          {
            errors: [
              { code: 'DeleteFailed', status: '500', detail: 'delete failed' },
            ],
          },
          { status: 500 },
        ),
      ),
    );

    const res = await createPteronUserAction({
      email: 'orphan@example.com',
      username: 'orphan',
      password: 'pw12345678',
      role: 'USER',
      createPterodactyl: true,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('failed');
      expect(res.detail).toContain('9');
    }
  });

  it('deletePteronUser reports Pterodactyl delete failure and keeps local user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'victim',
      pteroUserId: 8,
    });
    mswServer.use(
      http.delete(`${BASE}/users/8`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                code: 'DeleteFailed',
                status: '500',
                detail: 'panel delete failed',
              },
            ],
          },
          { status: 500 },
        ),
      ),
    );

    const res = await deletePteronUserAction('victim', true);

    expect(res.ok).toBe(false);
    // The raw 5xx upstream detail must not leak to the client; a generic
    // message is surfaced instead (see friendlyMessage default branch).
    if (!res.ok) {
      expect(res.detail).toBe('오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      expect(res.detail).not.toContain('panel delete failed');
    }
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });
});
