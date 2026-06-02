import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { resolveAccessibleServers, invalidateAccessCache } from './access';

const APP = 'https://panel.test/api/application';
const CLIENT = 'https://panel.test/api/client';

function listEnvelope(servers: Array<{ identifier: string; uuid: string; name: string; internal_id?: number }>) {
  return {
    object: 'list',
    data: servers.map((server) => ({ object: 'server', attributes: server })),
    meta: { pagination: { total: servers.length, count: servers.length, per_page: 100, current_page: 1, total_pages: 1 } },
  };
}

describe('resolveAccessibleServers', () => {
  beforeEach(() => invalidateAccessCache());

  it('ADMIN gets every server via client admin-all', async () => {
    mswServer.use(
      http.get(`${CLIENT}/`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('type')).toBe('admin-all');
        return HttpResponse.json(
          listEnvelope([{ identifier: 'aaaaaaaa', uuid: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'All', internal_id: 1 }]),
        );
      }),
    );
    const out = await resolveAccessibleServers({ id: 'u-admin', role: 'ADMIN', pteroUserId: null });
    expect(out.map((server) => server.identifier)).toEqual(['aaaaaaaa']);
  });

  it('USER gets only owned servers via application', async () => {
    mswServer.use(
      http.get(`${APP}/users/7`, () =>
        HttpResponse.json({
          object: 'user',
          attributes: {
            id: 7,
            relationships: {
              servers: listEnvelope([{ identifier: 'bbbbbbbb', uuid: 'bbbbbbbb-0000-4000-8000-000000000000', name: 'Mine', internal_id: 2 }]),
            },
          },
        }),
      ),
    );
    const out = await resolveAccessibleServers({ id: 'u-7', role: 'USER', pteroUserId: 7 });
    expect(out.map((server) => server.identifier)).toEqual(['bbbbbbbb']);
  });

  it('USER without mapping gets an empty set', async () => {
    const out = await resolveAccessibleServers({ id: 'u-x', role: 'USER', pteroUserId: null });
    expect(out).toEqual([]);
  });

  it('caches results (second call does not refetch)', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${CLIENT}/`, () => {
        calls += 1;
        return HttpResponse.json(
          listEnvelope([{ identifier: 'cccccccc', uuid: 'cccccccc-0000-4000-8000-000000000000', name: 'C' }]),
        );
      }),
    );
    const user = { id: 'u-admin2', role: 'ADMIN' as const, pteroUserId: null };
    await resolveAccessibleServers(user);
    await resolveAccessibleServers(user);
    expect(calls).toBe(1);
  });
});
