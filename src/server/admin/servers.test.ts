import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';

let currentUser: any = { id: 'admin', role: 'ADMIN', pteroUserId: null };
vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => currentUser),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { listServersAction, createServerAction } from './servers';

const BASE = 'https://panel.test/api/application';
beforeEach(() => {
  currentUser = { id: 'admin', role: 'ADMIN', pteroUserId: null };
});

describe('admin server actions', () => {
  it('non-admin rejected', async () => {
    currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    expect(await listServersAction()).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('createServerAction validates and posts', async () => {
    let body: any;
    mswServer.use(
      http.post(`${BASE}/servers`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'server',
          attributes: {
            id: 9,
            uuid: 'u',
            identifier: '1a2b3c4d',
            name: 'New',
            user: 7,
            node: 1,
            suspended: false,
            limits: {
              memory: 1024,
              swap: 0,
              disk: 5120,
              io: 500,
              cpu: 100,
            },
            feature_limits: { databases: 1, allocations: 1, backups: 1 },
          },
        });
      }),
    );
    const res = await createServerAction({
      name: 'New',
      user: 7,
      egg: 5,
      dockerImage: 'img',
      startup: 'java',
      environment: { V: 'latest' },
      limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 },
      featureLimits: { databases: 1, allocations: 1, backups: 1 },
      locationIds: [1],
      portRange: ['25565-25570'],
      startOnCompletion: true,
    });
    expect(res.ok).toBe(true);
    expect(body).toMatchObject({
      name: 'New',
      user: 7,
      egg: 5,
      deploy: { locations: [1], port_range: ['25565-25570'] },
    });
  });

  it('createServerAction rejects invalid input', async () => {
    const res = await createServerAction({ name: '', user: 0 } as any);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
  });
});
