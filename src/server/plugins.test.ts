import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    plugin: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: 'pl1', ...data })),
      findFirst: vi.fn(async () => ({ id: 'pl1', ownerId: 'u1', enabled: true })),
      update: vi.fn(async ({ data }: any) => ({ id: 'pl1', ...data })),
      delete: vi.fn(async () => ({ id: 'pl1' })),
    },
  },
  currentUser: { id: 'u1', role: 'USER', pteroUserId: 7 } as any,
}));

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => mocks.currentUser),
}));

import { deletePluginAction, listPluginsAction, registerPluginAction } from './plugins';

beforeEach(() => {
  mocks.currentUser = { id: 'u1', role: 'USER', pteroUserId: 7 };
  vi.clearAllMocks();
});

describe('plugin actions', () => {
  it('registers a plugin and returns the token ONCE', async () => {
    const res = await registerPluginAction({
      name: 'My Plugin',
      webhookUrl: 'https://hook.example.com',
      events: ['server.power'],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.token).toMatch(/^ptex_/);
      expect(res.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(mocks.prisma.plugin.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 'u1', name: 'My Plugin' }),
      }),
    );
  });

  it("lists only the caller's plugins", async () => {
    await listPluginsAction();
    expect(mocks.prisma.plugin.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'u1' } }),
    );
  });

  it('delete enforces ownership (findFirst by id+ownerId)', async () => {
    await deletePluginAction('pl1');
    expect(mocks.prisma.plugin.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pl1', ownerId: 'u1' } }),
    );
  });
});
