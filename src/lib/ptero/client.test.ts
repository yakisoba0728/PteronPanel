import { describe, it, expect } from 'vitest';
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
