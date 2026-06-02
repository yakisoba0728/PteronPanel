import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticatePlugin: vi.fn(),
  resolveAccessibleServers: vi.fn(),
  powerServer: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/plugins/auth', () => ({
  authenticatePlugin: mocks.authenticatePlugin,
}));
vi.mock('@/lib/authz/access', () => ({
  resolveAccessibleServers: mocks.resolveAccessibleServers,
}));
vi.mock('@/lib/ptero/client', () => ({
  powerServer: mocks.powerServer,
}));
vi.mock('@/lib/audit', () => ({
  audit: mocks.audit,
}));

import { POST } from './route';

beforeEach(() => vi.clearAllMocks());

describe('POST /api/ext/servers/:id/power', () => {
  it('returns 404 when plugin owner cannot access the server', async () => {
    const owner = { id: 'u1', role: 'USER', pteroUserId: 7 };
    mocks.authenticatePlugin.mockResolvedValue({ pluginId: 'pl1', owner });
    mocks.resolveAccessibleServers.mockResolvedValue([]);

    const res = await POST(
      new Request('https://x/api/ext/servers/9z9z9z9z/power', {
        method: 'POST',
        body: JSON.stringify({ signal: 'restart' }),
      }),
      { params: Promise.resolve({ id: '9z9z9z9z' }) },
    );

    expect(res.status).toBe(404);
    expect(mocks.resolveAccessibleServers).toHaveBeenCalledWith(owner);
    expect(mocks.powerServer).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
