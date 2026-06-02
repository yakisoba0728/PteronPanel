import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { listFiles, getFileDownloadUrl, deleteFiles, createFolder, getFileUploadUrl } from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');

describe('client files', () => {
  it('listFiles maps directory entries', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/list`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('directory')).toBe('/logs');
        return HttpResponse.json({
          object: 'list',
          data: [{ object: 'file_object', attributes: { name: 'latest.log', mode: '-rw-r--r--', mode_bits: '0644', size: 12, is_file: true, is_symlink: false, mimetype: 'text/plain', created_at: '', modified_at: '' } }],
        });
      }),
    );
    const entries = await listFiles(id, '/logs');
    expect(entries[0]).toMatchObject({ name: 'latest.log', is_file: true });
  });

  it('getFileDownloadUrl returns the signed url', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/download`, () =>
        HttpResponse.json({ object: 'signed_url', attributes: { url: 'https://node/dl?token=x' } })),
    );
    expect(await getFileDownloadUrl(id, '/a.txt')).toBe('https://node/dl?token=x');
  });

  it('getFileUploadUrl returns the signed url', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/upload`, () =>
        HttpResponse.json({ object: 'signed_url', attributes: { url: 'https://node/up?token=y' } })),
    );
    expect(await getFileUploadUrl(id)).toBe('https://node/up?token=y');
  });

  it('deleteFiles posts {root, files}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/files/delete`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await deleteFiles(id, '/', ['old.log', 'cache/']);
    expect(body).toEqual({ root: '/', files: ['old.log', 'cache/'] });
  });

  it('createFolder posts {root, name}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/files/create-folder`, async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await createFolder(id, '/', 'plugins');
    expect(body).toEqual({ root: '/', name: 'plugins' });
  });
});
