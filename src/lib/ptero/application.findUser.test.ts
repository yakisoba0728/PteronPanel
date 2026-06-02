import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { findUserByEmail } from './application';

const BASE = 'https://panel.test/api/application';

describe('application.findUserByEmail', () => {
  it('returns {id, uuid} for a matching email', async () => {
    mswServer.use(
      http.get(`${BASE}/users`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('filter[email]')).toBe('a@b.com');
        return HttpResponse.json({
          object: 'list',
          data: [{ object: 'user', attributes: { id: 5, uuid: 'uuid-5', email: 'a@b.com' } }],
          meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } },
        });
      }),
    );
    expect(await findUserByEmail('a@b.com')).toEqual({ id: 5, uuid: 'uuid-5' });
  });

  it('returns null when no user matches', async () => {
    mswServer.use(
      http.get(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [],
          meta: { pagination: { total: 0, count: 0, per_page: 50, current_page: 1, total_pages: 1 } },
        }),
      ),
    );
    expect(await findUserByEmail('missing@b.com')).toBeNull();
  });
});
