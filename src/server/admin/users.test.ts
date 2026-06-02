import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const { prismaMock, userState } = vi.hoisted(() => ({
  userState: {
    currentUser: { id: 'admin', role: 'ADMIN', pteroUserId: null } as any,
  },
  prismaMock: {
  user: {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
    update: vi.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
    delete: vi.fn(async () => ({ id: 'p1' })),
  },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => userState.currentUser),
}));

import { createPteronUserAction, listPteronUsersAction } from './users';

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
});
