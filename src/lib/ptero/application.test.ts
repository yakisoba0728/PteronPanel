import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { getOwnedServers, paginateAll } from './application';

const BASE = 'https://panel.test/api/application';

describe('application.getOwnedServers', () => {
  it("maps a user's owned servers (include=servers) to AccessibleServer[]", async () => {
    mswServer.use(
      http.get(`${BASE}/users/7`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('include')).toBe('servers');
        return HttpResponse.json({
          object: 'user',
          attributes: {
            id: 7,
            relationships: {
              servers: {
                object: 'list',
                data: [
                  {
                    object: 'server',
                    attributes: {
                      id: 12,
                      identifier: '1a2b3c4d',
                      uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
                      name: 'Alpha',
                    },
                  },
                ],
              },
            },
          },
        });
      })
    );

    const servers = await getOwnedServers(7);

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      identifier: '1a2b3c4d',
      name: 'Alpha',
      numericId: 12,
    });
  });

  it('skips rows that fail validation instead of throwing the whole list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mswServer.use(
      http.get(`${BASE}/users/7`, () =>
        HttpResponse.json({
          object: 'user',
          attributes: {
            id: 7,
            relationships: {
              servers: {
                object: 'list',
                data: [
                  {
                    object: 'server',
                    attributes: {
                      id: 11,
                      // invalid: identifier length !== 8
                      identifier: 'bad',
                      uuid: '11111111-0000-4000-8000-000000000000',
                      name: 'Broken',
                    },
                  },
                  {
                    object: 'server',
                    attributes: {
                      id: 12,
                      identifier: '1a2b3c4d',
                      uuid: '1a2b3c4d-5e6f-7081-9234-567890abcdef',
                      name: 'Good',
                    },
                  },
                ],
              },
            },
          },
        })
      )
    );

    const servers = await getOwnedServers(7);

    expect(servers.map((server) => server.name)).toEqual(['Good']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('paginateAll', () => {
  it('iterates every page until total_pages', async () => {
    let page = 0;
    const fetchPage = async (p: number) => {
      page = p;
      return {
        object: 'list' as const,
        data: [{ object: 'x', attributes: { n: p } }],
        meta: {
          pagination: {
            total: 2,
            count: 1,
            per_page: 1,
            current_page: p,
            total_pages: 2,
          },
        },
      };
    };

    const all = await paginateAll(fetchPage);

    expect(all.map((item) => item.attributes.n)).toEqual([1, 2]);
    expect(page).toBe(2);
  });
});
