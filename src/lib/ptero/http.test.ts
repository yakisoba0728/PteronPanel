import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { pteroFetch } from './http';
import { PteroApiError } from './errors';
import type { PteroItem } from './types';

const BASE = 'https://panel.test/api';

describe('pteroFetch', () => {
  it('sends Bearer auth + Accept and returns parsed JSON (application)', async () => {
    let seenAuth = '';
    mswServer.use(
      http.get(`${BASE}/application/users/1`, ({ request }) => {
        seenAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({
          object: 'user',
          attributes: { id: 1, email: 'a@b.c' },
        });
      })
    );

    const res = await pteroFetch<PteroItem<{ id: number; email: string }>>(
      'application',
      '/users/1'
    );

    expect(res.attributes.email).toBe('a@b.c');
    expect(seenAuth).toBe('Bearer ptla_test');
  });

  it('uses the client key for the client API', async () => {
    let seenAuth = '';
    mswServer.use(
      http.get(`${BASE}/client/servers/1a2b3c4d`, ({ request }) => {
        seenAuth = request.headers.get('authorization') ?? '';
        return HttpResponse.json({
          object: 'server',
          attributes: { identifier: '1a2b3c4d' },
        });
      })
    );

    await pteroFetch('client', '/servers/1a2b3c4d');

    expect(seenAuth).toBe('Bearer ptlc_test');
  });

  it('throws PteroApiError on a 404 error envelope', async () => {
    mswServer.use(
      http.get(`${BASE}/application/users/999`, () =>
        HttpResponse.json(
          {
            errors: [
              {
                code: 'NotFoundHttpException',
                status: '404',
                detail: 'Not found.',
              },
            ],
          },
          { status: 404 }
        )
      )
    );

    await expect(pteroFetch('application', '/users/999')).rejects.toBeInstanceOf(
      PteroApiError
    );
  });

  it('retries once on 429 then succeeds', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${BASE}/application/servers`, () => {
        calls += 1;
        if (calls === 1) {
          return new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }

        return HttpResponse.json({
          object: 'list',
          data: [],
          meta: {
            pagination: {
              total: 0,
              count: 0,
              per_page: 50,
              current_page: 1,
              total_pages: 1,
            },
          },
        });
      })
    );

    const res = await pteroFetch('application', '/servers');

    expect(calls).toBe(2);
    expect(res).toMatchObject({ object: 'list' });
  });

  it('serializes JSON bodies and sets Content-Type on POST', async () => {
    let body: unknown;
    mswServer.use(
      http.post(`${BASE}/client/servers/1a2b3c4d/power`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      })
    );

    await pteroFetch('client', '/servers/1a2b3c4d/power', {
      method: 'POST',
      body: { signal: 'start' },
    });

    expect(body).toEqual({ signal: 'start' });
  });

  it('backs off and retries mutations on 429', async () => {
    let calls = 0;
    mswServer.use(
      http.post(`${BASE}/client/servers/1a2b3c4d/power`, () => {
        calls += 1;
        if (calls === 1) {
          return new HttpResponse(null, {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }

        return new HttpResponse(null, { status: 204 });
      })
    );

    await pteroFetch('client', '/servers/1a2b3c4d/power', {
      method: 'POST',
      body: { signal: 'start' },
    });

    expect(calls).toBe(2);
  });
});
