import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { createUser, deleteUser, listUsers, updateUser } from './application';

const BASE = 'https://panel.test/api/application';

const userAttrs = (over = {}) => ({
  id: 1,
  uuid: 'u-1',
  username: 'bob',
  email: 'bob@x.com',
  first_name: 'Bob',
  last_name: 'B',
  root_admin: false,
  created_at: '',
  ...over,
});

describe('application users', () => {
  it('listUsers paginates and maps', async () => {
    mswServer.use(
      http.get(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [{ object: 'user', attributes: userAttrs() }],
          meta: {
            pagination: {
              total: 1,
              count: 1,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        }),
      ),
    );
    const users = await listUsers();
    expect(users[0]).toMatchObject({ id: 1, email: 'bob@x.com' });
  });

  it('createUser posts mapped fields', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/users`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'user',
          attributes: userAttrs({ id: 9 }),
        });
      }),
    );
    const user = await createUser({
      email: 'a@b.com',
      username: 'a',
      first_name: 'A',
      last_name: 'B',
      password: 'pw',
    });
    expect(body).toMatchObject({
      email: 'a@b.com',
      username: 'a',
      first_name: 'A',
      last_name: 'B',
      password: 'pw',
    });
    expect(user.id).toBe(9);
  });

  it('updateUser PATCHes', async () => {
    let body: unknown;
    mswServer.use(
      http.patch(`${BASE}/users/9`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          object: 'user',
          attributes: userAttrs({ id: 9, email: 'new@x.com' }),
        });
      }),
    );
    const user = await updateUser(9, { email: 'new@x.com' });
    expect(body).toEqual({ email: 'new@x.com' });
    expect(user.email).toBe('new@x.com');
  });

  it('deleteUser DELETEs', async () => {
    let called = false;
    mswServer.use(
      http.delete(`${BASE}/users/9`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteUser(9);
    expect(called).toBe(true);
  });
});
