import { describe, expect, it, vi } from 'vitest';

const guardMocks = vi.hoisted(() => ({
  requireServerAccess: vi.fn(async () => ({})),
}));

vi.mock('@/lib/authz/guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/authz/guard')>(
    '@/lib/authz/guard',
  );
  return {
    ...actual,
    requireServerAccess: guardMocks.requireServerAccess,
  };
});

import { ServerAccessDeniedError } from '@/lib/authz/guard';
import { extError } from './respond';
import { pluginServer } from './scope';

const owner = { id: 'u1', role: 'USER' as const, pteroUserId: 7 };

describe('pluginServer malformed identifier', () => {
  it('maps a bad-length identifier to ServerAccessDeniedError (404), not a 500', async () => {
    await expect(pluginServer(owner, 'too-long-identifier')).rejects.toBeInstanceOf(
      ServerAccessDeniedError,
    );
    // Never touches the access layer for a structurally invalid id.
    expect(guardMocks.requireServerAccess).not.toHaveBeenCalled();
  });

  it('extError maps that error to a 404 not_found response', async () => {
    let thrown: unknown;
    try {
      await pluginServer(owner, 'bad');
    } catch (err) {
      thrown = err;
    }
    const res = extError(thrown);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('passes a valid 8-char identifier through to requireServerAccess', async () => {
    guardMocks.requireServerAccess.mockClear();
    const id = await pluginServer(owner, '1a2b3c4d');
    expect(id).toBe('1a2b3c4d');
    expect(guardMocks.requireServerAccess).toHaveBeenCalledWith(owner, '1a2b3c4d');
  });
});
