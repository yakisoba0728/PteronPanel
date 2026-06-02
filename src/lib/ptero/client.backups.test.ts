import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listBackups, createBackup, getBackupDownloadUrl, restoreBackup, deleteBackup } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');

describe('client backups', () => {
  it('listBackups maps entries', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/backups`, () =>
        HttpResponse.json({ object: 'list', data: [{ object: 'backup', attributes: { uuid: 'b-1', name: 'daily', bytes: 1024, checksum: 'abc', is_locked: false, is_successful: true, created_at: '', completed_at: '' } }], meta: { pagination: { total: 1, count: 1, per_page: 20, current_page: 1, total_pages: 1 } } })),
    );
    const out = await listBackups(id);
    expect(out[0]).toMatchObject({ uuid: 'b-1', name: 'daily', is_successful: true });
  });

  it('createBackup posts {name}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/backups`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ object: 'backup', attributes: { uuid: 'b-2', name: 'manual', bytes: 0, checksum: null, is_locked: false, is_successful: false, created_at: '', completed_at: null } }); }),
    );
    const b = await createBackup(id, { name: 'manual' });
    expect(body).toEqual({ name: 'manual' });
    expect(b.uuid).toBe('b-2');
  });

  it('getBackupDownloadUrl returns the signed url', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/backups/b-1/download`, () =>
        HttpResponse.json({ object: 'signed_url', attributes: { url: 'https://node/bk?token=z' } })),
    );
    expect(await getBackupDownloadUrl(id, 'b-1')).toBe('https://node/bk?token=z');
  });

  it('restoreBackup posts {truncate}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/backups/b-1/restore`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await restoreBackup(id, 'b-1', true);
    expect(body).toEqual({ truncate: true });
  });

  it('deleteBackup DELETEs', async () => {
    let called = false;
    mswServer.use(
      http.delete(`${BASE}/servers/1a2b3c4d/backups/b-1`, () => { called = true; return new HttpResponse(null, { status: 204 }); }),
    );
    await deleteBackup(id, 'b-1');
    expect(called).toBe(true);
  });
});
