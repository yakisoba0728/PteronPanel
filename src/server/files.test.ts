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
  copyAction,
  getDownloadUrlAction,
  listFilesAction,
  pullAction,
  readFileAction,
  writeFileAction,
} from './files';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

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

describe('file mutation actions', () => {
  it('returns not_found for inaccessible copy, write, and download URL actions', async () => {
    adminListsServer('1a2b3c4d');

    await expect(copyAction('deadbeef', '/server.properties')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(writeFileAction('deadbeef', '/server.properties', 'x')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    await expect(getDownloadUrlAction('deadbeef', '/server.properties')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects oversized writes before calling the Pterodactyl API', async () => {
    let writeCalled = false;
    adminListsServer('1a2b3c4d');
    mswServer.use(
      http.post(`${CLIENT}/servers/1a2b3c4d/files/write`, () => {
        writeCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await writeFileAction('1a2b3c4d', '/big.txt', 'a'.repeat(1024 * 1024 + 1));

    expect(res).toMatchObject({ ok: false, error: 'failed' });
    expect(writeCalled).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects binary reads after fetching file contents', async () => {
    adminListsServer('1a2b3c4d');
    mswServer.use(
      http.get(`${CLIENT}/servers/1a2b3c4d/files/contents`, () =>
        HttpResponse.text('text\0binary'),
      ),
    );

    const res = await readFileAction('1a2b3c4d', '/binary.dat');

    expect(res).toMatchObject({ ok: false, error: 'failed' });
  });

  it('rejects invalid pull URLs before calling the Pterodactyl API', async () => {
    let pullCalled = false;
    adminListsServer('1a2b3c4d');
    mswServer.use(
      http.post(`${CLIENT}/servers/1a2b3c4d/files/pull`, () => {
        pullCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await pullAction('1a2b3c4d', {
      url: 'ftp://example.com/server.jar',
      directory: '/',
    });

    expect(res).toMatchObject({ ok: false, error: 'failed' });
    expect(pullCalled).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('audits pull actions with a redacted URL', async () => {
    let body: unknown;
    adminListsServer('1a2b3c4d');
    mswServer.use(
      http.post(`${CLIENT}/servers/1a2b3c4d/files/pull`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await pullAction('1a2b3c4d', {
      url: 'https://user:pass@example.com/path/server.jar?token=secret#frag',
      directory: '/',
      filename: 'server.jar',
    });

    expect(res).toEqual({ ok: true });
    expect(body).toMatchObject({
      url: 'https://user:pass@example.com/path/server.jar?token=secret#frag',
    });
    expect(audit).toHaveBeenCalledWith(
      'file.pull',
      expect.objectContaining({
        userId: 'u1',
        target: '1a2b3c4d',
        metadata: {
          url: 'https://example.com/path/server.jar',
          directory: '/',
          filename: 'server.jar',
        },
      }),
    );
  });
});
