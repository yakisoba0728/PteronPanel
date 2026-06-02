import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

const { audit } = vi.hoisted(() => ({
  audit: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null })),
}));

vi.mock('@/lib/audit', () => ({
  audit,
}));

import {
  backupDownloadUrlAction,
  deleteBackupAction,
  listBackupsAction,
  restoreBackupAction,
  toggleBackupLockAction,
} from './backups';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

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

describe('backup mutation actions', () => {
  it('returns not_found for inaccessible restore, delete, lock, and download actions', async () => {
    adminListsServer('1a2b3c4d');

    await expect(restoreBackupAction('deadbeef', 'b1', false)).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(deleteBackupAction('deadbeef', 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(toggleBackupLockAction('deadbeef', 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(backupDownloadUrlAction('deadbeef', 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses to delete a locked backup without issuing the DELETE', async () => {
    adminListsServer('1a2b3c4d');
    const deleteSpy = vi.fn();
    mswServer.use(
      http.get(`${CLIENT}/servers/1a2b3c4d/backups/b1`, () =>
        HttpResponse.json({
          object: 'backup',
          attributes: {
            uuid: 'b1',
            name: 'daily',
            bytes: 1,
            checksum: null,
            is_locked: true,
            is_successful: true,
            created_at: '',
            completed_at: '',
          },
        }),
      ),
      http.delete(`${CLIENT}/servers/1a2b3c4d/backups/b1`, () => {
        deleteSpy();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await deleteBackupAction('1a2b3c4d', 'b1');

    expect(res).toEqual({ ok: false, error: 'locked' });
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('audits backup lock toggles', async () => {
    adminListsServer('1a2b3c4d');
    mswServer.use(
      http.post(`${CLIENT}/servers/1a2b3c4d/backups/b1/lock`, () =>
        HttpResponse.json({
          object: 'backup',
          attributes: {
            uuid: 'b1',
            name: 'daily',
            bytes: 1,
            checksum: null,
            is_locked: true,
            is_successful: true,
            created_at: '',
            completed_at: '',
          },
        }),
      ),
    );

    const res = await toggleBackupLockAction('1a2b3c4d', 'b1');

    expect(res.ok).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      'backup.lock',
      expect.objectContaining({
        userId: 'u1',
        target: '1a2b3c4d',
        metadata: { uuid: 'b1', locked: true },
      }),
    );
  });
});
