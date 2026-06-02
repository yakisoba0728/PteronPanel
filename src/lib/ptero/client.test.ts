import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  listServers,
  getResources,
  powerServer,
  getWebsocketCredentials,
} from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';

describe('client.listServers', () => {
  it('passes ?type=admin-all and maps results', async () => {
    mswServer.use(
      http.get(`${BASE}/`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('type')).toBe('admin-all');
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                identifier: '1a2b3c4d',
                internal_id: 12,
                uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
                name: 'Alpha',
              },
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
      })
    );

    const servers = await listServers('admin-all');

    expect(servers[0]).toMatchObject({ identifier: '1a2b3c4d', name: 'Alpha' });
  });

  it('paginates admin-all server results', async () => {
    const seenPages: string[] = [];
    mswServer.use(
      http.get(`${BASE}/`, ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        seenPages.push(String(page));
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                identifier: page === 1 ? '11111111' : '22222222',
                internal_id: page,
                uuid:
                  page === 1
                    ? '11111111-0000-4000-8000-000000000000'
                    : '22222222-0000-4000-8000-000000000000',
                name: `Page ${page}`,
              },
            },
          ],
          meta: {
            pagination: {
              total: 2,
              count: 1,
              per_page: 1,
              current_page: page,
              total_pages: 2,
            },
          },
        });
      })
    );

    const servers = await listServers('admin-all');

    expect(seenPages).toEqual(['1', '2']);
    expect(servers.map((server) => server.name)).toEqual(['Page 1', 'Page 2']);
  });

  it('skips rows that fail validation instead of throwing the whole list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mswServer.use(
      http.get(`${BASE}/`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'server',
              attributes: {
                // invalid: identifier length !== 8
                identifier: 'bad',
                internal_id: 1,
                uuid: '11111111-0000-4000-8000-000000000000',
                name: 'Broken',
              },
            },
            {
              object: 'server',
              attributes: {
                identifier: '1a2b3c4d',
                internal_id: 2,
                uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
                name: 'Good',
              },
            },
          ],
          meta: {
            pagination: {
              total: 2,
              count: 2,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        })
      )
    );

    const servers = await listServers('admin-all');

    expect(servers.map((server) => server.name)).toEqual(['Good']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('client.getResources', () => {
  it('flattens the stats envelope', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/resources`, () =>
        HttpResponse.json({
          object: 'stats',
          attributes: {
            current_state: 'running',
            is_suspended: false,
            resources: {
              memory_bytes: 100,
              cpu_absolute: 1.5,
              disk_bytes: 200,
              network_rx_bytes: 1,
              network_tx_bytes: 2,
              uptime: 3000,
            },
          },
        })
      )
    );

    const resources = await getResources(asIdentifier('1a2b3c4d'));

    expect(resources).toMatchObject({
      current_state: 'running',
      memory_bytes: 100,
      cpu_absolute: 1.5,
    });
  });
});

describe('client.powerServer', () => {
  it('POSTs { signal }', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/power`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      })
    );

    await powerServer(asIdentifier('1a2b3c4d'), 'restart');

    expect(body).toEqual({ signal: 'restart' });
  });
});

describe('client.getWebsocketCredentials', () => {
  it('returns { token, socket }', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/websocket`, () =>
        HttpResponse.json({
          data: {
            token: 'jwt-x',
            socket: 'wss://node:8080/api/servers/uuid/ws',
          },
        })
      )
    );

    const creds = await getWebsocketCredentials(asIdentifier('1a2b3c4d'));

    expect(creds).toEqual({
      token: 'jwt-x',
      socket: 'wss://node:8080/api/servers/uuid/ws',
    });
  });
});
