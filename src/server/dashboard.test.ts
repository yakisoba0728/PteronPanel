import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    role: 'ADMIN',
    pteroUserId: null,
    pteroUuid: null,
    username: 'admin',
  })),
}));

import { getDashboardAction } from './dashboard';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());

describe('getDashboardAction', () => {
  it('summarizes accessible servers', async () => {
    mswServer.use(
      http.get(`${CLIENT}/`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                identifier: 'aaaaaaaa',
                uuid: 'aaaaaaaa-0000-4000-8000-000000000000',
                name: 'A',
              },
            },
            {
              object: 'server',
              attributes: {
                identifier: 'bbbbbbbb',
                uuid: 'bbbbbbbb-0000-4000-8000-000000000000',
                name: 'B',
              },
            },
          ],
          meta: {
            pagination: {
              total: 2,
              count: 2,
              per_page: 100,
              current_page: 1,
              total_pages: 1,
            },
          },
        }),
      ),
    );
    const res = await getDashboardAction();
    expect(res.ok && res.totalServers).toBe(2);
  });
});
