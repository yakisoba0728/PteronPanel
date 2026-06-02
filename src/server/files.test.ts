import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })),
}));

import { listFilesAction } from './files';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => invalidateAccessCache());

function adminListsServer(identifier: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier, uuid: `${identifier}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })),
  );
}

describe('listFilesAction', () => {
  it('returns entries for an accessible server', async () => {
    adminListsServer('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/files/list`, () => HttpResponse.json({ object: 'list', data: [{ object: 'file_object', attributes: { name: 'a.txt', mode: '-rw-r--r--', mode_bits: '0644', size: 1, is_file: true, is_symlink: false, mimetype: 'text/plain', created_at: '', modified_at: '' } }] })));
    const res = await listFilesAction('1a2b3c4d', '/');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries[0].name).toBe('a.txt');
  });

  it('returns not_found for an inaccessible server', async () => {
    adminListsServer('1a2b3c4d');
    const res = await listFilesAction('deadbeef', '/');
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });
});
