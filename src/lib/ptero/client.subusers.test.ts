import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  listSubusers,
  createSubuser,
  updateSubuser,
  deleteSubuser,
  listPermissionKeys,
} from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const sub = (over = {}) => ({
  object: 'server_subuser',
  attributes: {
    uuid: 'sub-uuid',
    username: 'bob',
    email: 'bob@x.com',
    image: '',
    permissions: ['control.console', 'file.read'],
    ...over,
  },
});

describe('client subusers', () => {
  it('listSubusers maps', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/users`, () =>
        HttpResponse.json({ object: 'list', data: [sub()] }),
      ),
    );
    expect((await listSubusers(id))[0]).toMatchObject({
      uuid: 'sub-uuid',
      email: 'bob@x.com',
      permissions: ['control.console', 'file.read'],
    });
  });

  it('createSubuser posts {email, permissions}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/users`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(sub());
      }),
    );
    await createSubuser(id, 'bob@x.com', ['control.console']);
    expect(body).toEqual({
      email: 'bob@x.com',
      permissions: ['control.console'],
    });
  });

  it('updateSubuser posts {permissions}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(
        `${BASE}/servers/1a2b3c4d/users/sub-uuid`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(
            sub({ permissions: ['control.console', 'control.start'] }),
          );
        },
      ),
    );
    await updateSubuser(id, 'sub-uuid', [
      'control.console',
      'control.start',
    ]);
    expect(body).toEqual({
      permissions: ['control.console', 'control.start'],
    });
  });

  it('deleteSubuser DELETEs', async () => {
    let called = false;
    mswServer.use(
      http.delete(`${BASE}/servers/1a2b3c4d/users/sub-uuid`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteSubuser(id, 'sub-uuid');
    expect(called).toBe(true);
  });

  it('listPermissionKeys flattens group.key', async () => {
    mswServer.use(
      http.get(`${BASE}/permissions`, () =>
        HttpResponse.json({
          object: 'system_permissions',
          attributes: {
            permissions: {
              control: { description: '', keys: { console: '', start: '' } },
              file: { description: '', keys: { read: '' } },
            },
          },
        }),
      ),
    );
    const keys = await listPermissionKeys();
    expect(keys).toEqual(
      expect.arrayContaining(['control.console', 'control.start', 'file.read']),
    );
  });
});
