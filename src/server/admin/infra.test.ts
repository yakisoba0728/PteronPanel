import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

const userState = vi.hoisted(() => ({
  currentUser: { id: 'admin', role: 'ADMIN', pteroUserId: null } as any,
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => userState.currentUser),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { createLocationAction, listNodesAction } from './infra';

const BASE = 'https://panel.test/api/application';

beforeEach(() => {
  userState.currentUser = { id: 'admin', role: 'ADMIN', pteroUserId: null };
});

describe('admin infra actions', () => {
  it('non-admin rejected', async () => {
    userState.currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    expect(await listNodesAction()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listNodesAction returns nodes for admin', async () => {
    mswServer.use(
      http.get(`${BASE}/nodes`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'node',
              attributes: {
                id: 1,
                name: 'n1',
                fqdn: 'n1.x',
                memory: 1,
                memory_overallocate: 0,
                disk: 1,
                disk_overallocate: 0,
                location_id: 1,
                maintenance_mode: false,
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
    const res = await listNodesAction();
    expect(res.ok && res.nodes[0].name).toBe('n1');
  });

  it('createLocationAction posts', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/locations`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'location',
          attributes: { id: 3, short: 'kr', long: 'Korea' },
        });
      }),
    );
    const res = await createLocationAction({ short: 'kr', long: 'Korea' });
    expect(res.ok).toBe(true);
    expect(body).toEqual({ short: 'kr', long: 'Korea' });
  });
});
