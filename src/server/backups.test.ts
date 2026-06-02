import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })),
}));

import { listBackupsAction } from './backups';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());

function adminListsServer(identifier: string) {
  mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [{ object: 'server', attributes: { identifier, uuid: `${identifier}-0000-4000-8000-000000000000`, name: 'S' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
}

describe('listBackupsAction', () => {
  it('returns backups for an accessible server', async () => {
    adminListsServer('1a2b3c4d');
    mswServer.use(http.get(`${CLIENT}/servers/1a2b3c4d/backups`, () => HttpResponse.json({ object: 'list', data: [{ object: 'backup', attributes: { uuid: 'b1', name: 'd', bytes: 1, checksum: null, is_locked: false, is_successful: true, created_at: '', completed_at: '' } }], meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } } })));
    const res = await listBackupsAction('1a2b3c4d');
    expect(res.ok && res.backups[0].uuid).toBe('b1');
  });

  it('returns not_found for inaccessible server', async () => {
    adminListsServer('1a2b3c4d');
    expect(await listBackupsAction('deadbeef')).toEqual({ ok: false, error: 'not_found' });
  });
});
