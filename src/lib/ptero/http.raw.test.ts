import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { pteroFetchText, pteroFetch } from './http';

const BASE = 'https://panel.test/api/client';

describe('raw http', () => {
  it('pteroFetchText returns the raw body (file contents)', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/files/contents`, () =>
        HttpResponse.text('gamemode=survival\n')),
    );
    const text = await pteroFetchText('client', '/servers/1a2b3c4d/files/contents', { query: { file: '/server.properties' } });
    expect(text).toBe('gamemode=survival\n');
  });

  it('sends a raw body with a custom content-type (file write)', async () => {
    let received = '';
    let ctype = '';
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/files/write`, async ({ request }) => {
        received = await request.text();
        ctype = request.headers.get('content-type') ?? '';
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await pteroFetch('client', '/servers/1a2b3c4d/files/write', {
      method: 'POST',
      rawBody: 'hello=world',
      contentType: 'text/plain',
      query: { file: '/a.txt' },
    });
    expect(received).toBe('hello=world');
    expect(ctype).toContain('text/plain');
  });
});
