import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  listAllServers,
  createServer,
  suspendServer,
  unsuspendServer,
  deleteServer,
  updateServerDetails,
} from './application';

const BASE = 'https://panel.test/api/application';
const srv = (over = {}) => ({
  id: 1,
  uuid: 'suuid',
  identifier: '1a2b3c4d',
  name: 'srv',
  user: 7,
  node: 1,
  suspended: false,
  limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 },
  feature_limits: { databases: 1, allocations: 1, backups: 1 },
  ...over,
});

describe('application servers', () => {
  it('listAllServers paginates', async () => {
    mswServer.use(
      http.get(`${BASE}/servers`, () =>
        HttpResponse.json({
          object: 'list',
          data: [{ object: 'server', attributes: srv() }],
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
    expect((await listAllServers())[0]).toMatchObject({ id: 1, name: 'srv' });
  });

  it('createServer posts the full body (deploy)', async () => {
    let body: any;
    mswServer.use(
      http.post(`${BASE}/servers`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'server',
          attributes: srv({ id: 9 }),
        });
      }),
    );
    const s = await createServer({
      name: 'New',
      user: 7,
      egg: 5,
      docker_image: 'img',
      startup: 'java',
      environment: { V: 'latest' },
      limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 },
      feature_limits: { databases: 1, allocations: 1, backups: 1 },
      deploy: {
        locations: [1],
        dedicated_ip: false,
        port_range: ['25565-25570'],
      },
      start_on_completion: true,
    });
    expect(body).toMatchObject({
      name: 'New',
      user: 7,
      egg: 5,
      deploy: { locations: [1] },
      start_on_completion: true,
    });
    expect(s.id).toBe(9);
  });

  it('suspend / unsuspend / delete', async () => {
    let suspended = false;
    let unsuspended = false;
    let deleted = false;
    mswServer.use(
      http.post(`${BASE}/servers/9/suspend`, () => {
        suspended = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/servers/9/unsuspend`, () => {
        unsuspended = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/servers/9`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await suspendServer(9);
    await unsuspendServer(9);
    await deleteServer(9);
    expect([suspended, unsuspended, deleted]).toEqual([true, true, true]);
  });

  it('updateServerDetails PATCHes details', async () => {
    let body: any;
    mswServer.use(
      http.patch(`${BASE}/servers/9/details`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'server',
          attributes: srv({ id: 9, name: 'Renamed' }),
        });
      }),
    );
    const s = await updateServerDetails(9, { name: 'Renamed' });
    expect(body).toEqual({ name: 'Renamed' });
    expect(s.name).toBe('Renamed');
  });
});
