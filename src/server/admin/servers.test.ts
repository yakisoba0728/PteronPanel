import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import type { User } from '@prisma/client';

type CurrentUser = Pick<User, 'id' | 'role' | 'pteroUserId'>;

let currentUser: CurrentUser = {
  id: 'admin',
  role: 'ADMIN',
  pteroUserId: null,
};
vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => currentUser),
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import {
  createServerAction,
  deleteServerAction,
  listServersAction,
  updateServerBuildAction,
  updateServerStartupAction,
} from './servers';

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
    let body: unknown;
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
    const res = await createServerAction({
      name: '',
      user: 0,
    } as unknown as Parameters<typeof createServerAction>[0]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('validation');
  });

  it('non-admin cannot delete a server', async () => {
    currentUser = { id: 'u', role: 'USER', pteroUserId: 1 };
    const res = await deleteServerAction(9, true);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('updateServerBuildAction validates and sends flat build data', async () => {
    let body: unknown;
    mswServer.use(
      http.patch(`${BASE}/servers/9/build`, async ({ request }) => {
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
              memory: 2048,
              swap: 0,
              disk: 10240,
              io: 500,
              cpu: 150,
            },
            feature_limits: { databases: 2, allocations: 3, backups: 4 },
          },
        });
      }),
    );

    const res = await updateServerBuildAction(9, {
      allocation: 1,
      limits: { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 150 },
      featureLimits: { databases: 2, allocations: 3, backups: 4 },
    });

    expect(res).toEqual({ ok: true });
    expect(body).toEqual({
      allocation: 1,
      memory: 2048,
      swap: 0,
      disk: 10240,
      io: 500,
      cpu: 150,
      feature_limits: { databases: 2, allocations: 3, backups: 4 },
    });
  });

  it('updateServerStartupAction validates and sends complete startup data', async () => {
    let body: unknown;
    mswServer.use(
      http.patch(`${BASE}/servers/9/startup`, async ({ request }) => {
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
              memory: 2048,
              swap: 0,
              disk: 10240,
              io: 500,
              cpu: 150,
            },
            feature_limits: { databases: 2, allocations: 3, backups: 4 },
          },
        });
      }),
    );

    const res = await updateServerStartupAction(9, {
      startup: 'java -jar server.jar',
      egg: 5,
      image: 'ghcr.io/pterodactyl/yolks:java_21',
      environment: { MC_VERSION: '1.21.1' },
      skipScripts: false,
    });

    expect(res).toEqual({ ok: true });
    expect(body).toEqual({
      startup: 'java -jar server.jar',
      egg: 5,
      image: 'ghcr.io/pterodactyl/yolks:java_21',
      environment: { MC_VERSION: '1.21.1' },
      skip_scripts: false,
    });
  });
});
