import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { requireServerAccess, ServerAccessDeniedError } from './guard';
import { invalidateAccessCache } from './access';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => invalidateAccessCache());

function adminList() {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [{ object: 'server', attributes: { identifier: '1a2b3c4d', uuid: '1a2b3c4d-0000-4000-8000-000000000000', name: 'A' } }],
        meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } },
      }),
    ),
  );
}

describe('requireServerAccess', () => {
  it('returns the server when the user can access it', async () => {
    adminList();
    const server = await requireServerAccess({ id: 'a', role: 'ADMIN', pteroUserId: null }, '1a2b3c4d');
    expect(server.name).toBe('A');
  });

  it('throws ServerAccessDeniedError when the user cannot', async () => {
    adminList();
    await expect(
      requireServerAccess({ id: 'a', role: 'ADMIN', pteroUserId: null }, 'deadbeef'),
    ).rejects.toBeInstanceOf(ServerAccessDeniedError);
  });
});
