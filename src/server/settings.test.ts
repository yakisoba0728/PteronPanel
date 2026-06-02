import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

const { audit } = vi.hoisted(() => ({
  audit: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    role: 'ADMIN',
    pteroUserId: null,
  })),
}));

vi.mock('@/lib/audit', () => ({
  audit,
}));

import { listActivityAction } from './activity';
import {
  reinstallServerAction,
  renameServerAction,
  setDockerImageAction,
} from './settings';
import { getStartupAction, updateStartupVariableAction } from './startup';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

function adminLists(idf: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [
          {
            object: 'server',
            attributes: {
              identifier: idf,
              uuid: `${idf}-0000-4000-8000-000000000000`,
              name: 'S',
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
}

describe('renameServerAction', () => {
  it('renames an accessible server', async () => {
    adminLists('1a2b3c4d');
    let body: unknown;
    mswServer.use(
      http.post(
        `${CLIENT}/servers/1a2b3c4d/settings/rename`,
        async ({ request }) => {
          body = await request.json();
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );
    const res = await renameServerAction('1a2b3c4d', 'New');
    expect(res.ok).toBe(true);
    expect(body).toMatchObject({ name: 'New' });
  });

  it('not_found for inaccessible', async () => {
    adminLists('1a2b3c4d');
    expect(await renameServerAction('deadbeef', 'X')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('startup/settings/activity action guards', () => {
  it.each([
    ['startup list', () => getStartupAction('deadbeef')],
    ['startup update', () => updateStartupVariableAction('deadbeef', 'VERSION', '1.21')],
    ['settings reinstall', () => reinstallServerAction('deadbeef')],
    ['settings docker image', () => setDockerImageAction('deadbeef', 'img:2')],
    ['activity list', () => listActivityAction('deadbeef')],
  ])('returns not_found for inaccessible %s', async (_name, action) => {
    adminLists('1a2b3c4d');

    expect(await action()).toEqual({ ok: false, error: 'not_found' });
  });
});
