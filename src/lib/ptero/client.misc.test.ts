import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  getStartupVariables,
  listActivity,
  reinstallServer,
  renameServer,
  setDockerImage,
  updateStartupVariable,
} from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');

describe('client startup/settings/activity', () => {
  it('getStartupVariables maps', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/startup`, () =>
        HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'egg_variable',
              attributes: {
                name: 'Version',
                description: '',
                env_variable: 'VERSION',
                default_value: 'latest',
                server_value: '1.20',
                is_editable: true,
                rules: 'required|string',
              },
            },
          ],
          meta: { startup_command: 'java', raw_startup_command: 'java' },
        }),
      ),
    );
    expect((await getStartupVariables(id))[0]).toMatchObject({
      env_variable: 'VERSION',
      server_value: '1.20',
    });
  });

  it('updateStartupVariable PUTs {key,value}', async () => {
    let body: unknown;
    mswServer.use(
      http.put(
        `${BASE}/servers/1a2b3c4d/startup/variable`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({
            object: 'egg_variable',
            attributes: {
              name: 'V',
              description: '',
              env_variable: 'VERSION',
              default_value: 'latest',
              server_value: '1.21',
              is_editable: true,
              rules: '',
            },
          });
        },
      ),
    );
    await updateStartupVariable(id, 'VERSION', '1.21');
    expect(body).toEqual({ key: 'VERSION', value: '1.21' });
  });

  it('renameServer/reinstallServer/setDockerImage', async () => {
    let renamed: unknown;
    let reinstalled = false;
    let image: unknown;
    mswServer.use(
      http.post(
        `${BASE}/servers/1a2b3c4d/settings/rename`,
        async ({ request }) => {
          renamed = await request.json();
          return new HttpResponse(null, { status: 204 });
        },
      ),
      http.post(`${BASE}/servers/1a2b3c4d/settings/reinstall`, () => {
        reinstalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.put(
        `${BASE}/servers/1a2b3c4d/settings/docker-image`,
        async ({ request }) => {
          image = await request.json();
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    await renameServer(id, 'New', 'desc');
    await reinstallServer(id);
    await setDockerImage(id, 'img:2');
    expect(renamed).toEqual({ name: 'New', description: 'desc' });
    expect(reinstalled).toBe(true);
    expect(image).toEqual({ docker_image: 'img:2' });
  });

  it('listActivity maps', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/activity`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('per_page')).toBe('50');
        return HttpResponse.json({
          object: 'list',
          data: [
            {
              object: 'activity_log',
              attributes: {
                id: 'a1',
                event: 'server:console.command',
                ip: '1.2.3.4',
                description: null,
                timestamp: '2026-01-01T00:00:00Z',
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
      }),
    );
    expect((await listActivity(id))[0]).toMatchObject({
      id: 'a1',
      event: 'server:console.command',
    });
  });
});
