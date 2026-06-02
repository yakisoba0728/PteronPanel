import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import {
  assignAllocation,
  deleteAllocation,
  listAllocations,
  setAllocationNote,
  setPrimaryAllocation,
} from './client';
import { asIdentifier } from './types';

const BASE = 'https://panel.test/api/client';
const id = asIdentifier('1a2b3c4d');
const alloc = (over = {}) => ({
  object: 'allocation',
  attributes: {
    id: 1,
    ip: '0.0.0.0',
    ip_alias: null,
    port: 25565,
    notes: null,
    is_default: true,
    ...over,
  },
});

describe('client network', () => {
  it('listAllocations maps', async () => {
    mswServer.use(
      http.get(`${BASE}/servers/1a2b3c4d/network/allocations`, () =>
        HttpResponse.json({ object: 'list', data: [alloc()] }),
      ),
    );
    expect((await listAllocations(id))[0]).toMatchObject({
      id: 1,
      port: 25565,
      is_default: true,
    });
  });

  it('assignAllocation POSTs', async () => {
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/network/allocations`, () =>
        HttpResponse.json(alloc({ id: 2, port: 25566, is_default: false })),
      ),
    );
    expect((await assignAllocation(id)).id).toBe(2);
  });

  it('setAllocationNote POSTs {notes}', async () => {
    let body: unknown;
    mswServer.use(
      http.post(
        `${BASE}/servers/1a2b3c4d/network/allocations/2`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(alloc({ id: 2, notes: 'web' }));
        },
      ),
    );
    await setAllocationNote(id, 2, 'web');
    expect(body).toEqual({ notes: 'web' });
  });

  it('setPrimaryAllocation + deleteAllocation', async () => {
    let primary = false;
    let deleted = false;
    mswServer.use(
      http.post(`${BASE}/servers/1a2b3c4d/network/allocations/2/primary`, () => {
        primary = true;
        return HttpResponse.json(alloc({ id: 2, is_default: true }));
      }),
      http.delete(`${BASE}/servers/1a2b3c4d/network/allocations/2`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await setPrimaryAllocation(id, 2);
    await deleteAllocation(id, 2);
    expect([primary, deleted]).toEqual([true, true]);
  });

  it('encodes allocation path ids before building URLs', async () => {
    let pathname = '';
    mswServer.use(
      http.delete('*', ({ request }) => {
        pathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await deleteAllocation(id, '..' as unknown as number);

    expect(pathname).toBe(
      '/api/client/servers/1a2b3c4d/network/allocations/%252E%252E',
    );
  });
});
