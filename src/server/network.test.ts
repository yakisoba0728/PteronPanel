import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { invalidateAccessCache } from '@/lib/authz/access';
import { mswServer } from '@/test/msw/server';

const { audit } = vi.hoisted(() => ({
  audit: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => ({
    id: 'u1',
    role: 'ADMIN',
    pteroUserId: null,
  })),
}));

vi.mock('@/lib/audit', () => ({
  audit,
}));

import {
  assignAllocationAction,
  deleteAllocationAction,
  listAllocationsAction,
  setAllocationNoteAction,
  setPrimaryAllocationAction,
} from './network';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => {
  invalidateAccessCache();
  vi.clearAllMocks();
});

function adminLists(idf: string) {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [
          {
            object: 'server',
            attributes: {
              identifier: idf,
              uuid: `${idf}-0000-4000-8000-000000000000`,
              name: 'S',
            },
          },
        ],
        meta: {
          pagination: {
            total: 1,
            count: 1,
            per_page: 100,
            current_page: 1,
            total_pages: 1,
          },
        },
      }),
    ),
  );
}

function allocation(over = {}) {
  return {
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
  };
}

describe('network action guards', () => {
  it.each([
    ['list', () => listAllocationsAction('deadbeef')],
    ['assign', () => assignAllocationAction('deadbeef')],
    ['note', () => setAllocationNoteAction('deadbeef', 1, 'web')],
    ['primary', () => setPrimaryAllocationAction('deadbeef', 1)],
    ['delete', () => deleteAllocationAction('deadbeef', 1)],
  ])('returns not_found for inaccessible %s', async (_name, action) => {
    adminLists('1a2b3c4d');

    expect(await action()).toEqual({ ok: false, error: 'not_found' });
  });

  it('audits a note change', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(
      http.post(`${CLIENT}/servers/1a2b3c4d/network/allocations/1`, () =>
        HttpResponse.json(allocation({ notes: 'web' })),
      ),
    );

    const res = await setAllocationNoteAction('1a2b3c4d', 1, 'web');

    expect(res).toEqual({ ok: true });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith('network.note', {
      userId: 'u1',
      target: '1a2b3c4d',
      metadata: { allocId: 1 },
    });
  });

  it('audits a primary allocation change', async () => {
    adminLists('1a2b3c4d');
    mswServer.use(
      http.post(
        `${CLIENT}/servers/1a2b3c4d/network/allocations/1/primary`,
        () => HttpResponse.json(allocation()),
      ),
    );

    const res = await setPrimaryAllocationAction('1a2b3c4d', 1);

    expect(res).toEqual({ ok: true });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith('network.primary', {
      userId: 'u1',
      target: '1a2b3c4d',
      metadata: { allocId: 1 },
    });
  });

  it('blocks deleting the default allocation server-side', async () => {
    adminLists('1a2b3c4d');
    let deleted = false;
    mswServer.use(
      http.get(`${CLIENT}/servers/1a2b3c4d/network/allocations`, () =>
        HttpResponse.json({ object: 'list', data: [allocation()] }),
      ),
      http.delete(`${CLIENT}/servers/1a2b3c4d/network/allocations/1`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await deleteAllocationAction('1a2b3c4d', 1);

    expect(res).toEqual({
      ok: false,
      error: 'failed',
      detail: '기본 할당은 삭제할 수 없습니다.',
    });
    expect(deleted).toBe(false);
  });

  it('rejects traversal in allocation ids before an upstream path can change servers', async () => {
    adminLists('1a2b3c4d');
    let crossedServerBoundary = false;
    mswServer.use(
      http.delete(`${CLIENT}/servers/deadbeef/databases/H1`, () => {
        crossedServerBoundary = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const res = await deleteAllocationAction(
      '1a2b3c4d',
      '../../../deadbeef/databases/H1' as unknown as number,
    );

    expect(res).toMatchObject({ ok: false, error: 'failed' });
    expect(crossedServerBoundary).toBe(false);
  });
});
