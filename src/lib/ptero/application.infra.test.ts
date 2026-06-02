import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  createLocation,
  getEgg,
  listEggs,
  listLocations,
  listNodes,
} from './application';

const BASE = 'https://panel.test/api/application';

describe('application infra', () => {
  it('listNodes maps', async () => {
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
                memory: 8192,
                memory_overallocate: 0,
                disk: 100000,
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
    expect((await listNodes())[0]).toMatchObject({ id: 1, name: 'n1' });
  });

  it('listLocations + createLocation', async () => {
    mswServer.use(
      http.get(`${BASE}/locations`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'location',
              attributes: { id: 1, short: 'us', long: 'US' },
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
    expect((await listLocations())[0].short).toBe('us');

    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/locations`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'location',
          attributes: { id: 2, short: 'eu', long: 'EU' },
        });
      }),
    );
    const loc = await createLocation({ short: 'eu', long: 'EU' });
    expect(body).toEqual({ short: 'eu', long: 'EU' });
    expect(loc.id).toBe(2);
  });

  it('listEggs + getEgg(variables)', async () => {
    mswServer.use(
      http.get(`${BASE}/nests/1/eggs`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'egg',
              attributes: {
                id: 5,
                name: 'Paper',
                docker_image: 'img',
                startup: 'java',
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
    expect((await listEggs(1))[0].name).toBe('Paper');

    mswServer.use(
      http.get(`${BASE}/nests/1/eggs/5`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('include')).toBe(
          'variables',
        );
        return HttpResponse.json({
          object: 'egg',
          attributes: {
            id: 5,
            name: 'Paper',
            docker_image: 'img',
            startup: 'java',
            relationships: {
              variables: {
                object: 'list',
                data: [
                  {
                    object: 'egg_variable',
                    attributes: {
                      name: 'Version',
                      description: '',
                      env_variable: 'VERSION',
                      default_value: 'latest',
                      rules: 'required|string',
                      user_editable: true,
                    },
                  },
                ],
              },
            },
          },
        });
      }),
    );
    const egg = await getEgg(1, 5);
    expect(egg.variables?.[0].env_variable).toBe('VERSION');
  });
});
