import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticatePlugin: vi.fn(),
  resolveAccessibleServers: vi.fn(),
}));

vi.mock('@/lib/plugins/auth', () => ({
  authenticatePlugin: mocks.authenticatePlugin,
}));
vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers: mocks.resolveAccessibleServers,
}));

import { GET } from './route';

beforeEach(() => vi.clearAllMocks());

const req = (auth = true) =>
  new Request('https://x/api/ext/servers', {
    headers: auth ? { authorization: 'Bearer ptex_x' } : {},
  });

describe('GET /api/ext/servers', () => {
  it('401 without valid plugin auth', async () => {
    mocks.authenticatePlugin.mockResolvedValue(null);

    const res = await GET(req(false));

    expect(res.status).toBe(401);
  });

  it('returns owner-scoped servers', async () => {
    const owner = { id: 'u1', role: 'USER', pteroUserId: 7 };
    mocks.authenticatePlugin.mockResolvedValue({ pluginId: 'pl1', owner });
    mocks.resolveAccessibleServers.mockResolvedValue([
      { identifier: '1a2b3c4d', uuid: 'u', name: 'A' },
    ]);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.servers[0].identifier).toBe('1a2b3c4d');
    expect(mocks.resolveAccessibleServers).toHaveBeenCalledWith(owner);
  });
});
