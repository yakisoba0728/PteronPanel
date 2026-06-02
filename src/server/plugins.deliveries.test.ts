import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: { id: 'u1', role: 'USER' as const, pteroUserId: 7 },
  deliverWebhook: vi.fn(async () => ({ ok: true, attempts: 2, status: 200 })),
  prisma: {
    plugin: {
      findFirst: vi.fn(async () => ({
        id: 'pl1',
        ownerId: 'u1',
        webhookUrl: 'https://a',
        webhookSecretEnc: 'e',
      })),
    },
    webhookDelivery: {
      findMany: vi.fn(async () => [
        {
          id: 'd1',
          event: 'server.power',
          status: 'failed',
          attempts: 1,
          responseCode: 500,
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          payload: {
            id: 'd1',
            event: 'server.power',
            server: '1a2b3c4d',
            actor: 'u1',
            data: { signal: 'restart' },
          },
        },
      ]),
      findFirst: vi.fn(async () => ({
        id: 'd1',
        pluginId: 'pl1',
        event: 'server.power',
        payload: {
          id: 'd1',
          event: 'server.power',
          server: '1a2b3c4d',
          actor: 'u1',
          data: { signal: 'restart' },
        },
      })),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/crypto', () => ({ decryptSecret: () => 'dec' }));
vi.mock('@/lib/plugins/webhook', () => ({
  deliverWebhook: mocks.deliverWebhook,
}));
vi.mock('@/lib/auth/current-user', () => ({
  requireUser: vi.fn(async () => mocks.currentUser),
}));

import { listDeliveriesAction, retryDeliveryAction } from './plugins';

beforeEach(() => {
  mocks.currentUser = { id: 'u1', role: 'USER', pteroUserId: 7 };
  vi.clearAllMocks();
});

describe('deliveries', () => {
  it('lists deliveries for an owned plugin', async () => {
    const r = await listDeliveriesAction('pl1');

    expect(r.ok && r.deliveries[0].id).toBe('d1');
    expect(mocks.prisma.plugin.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pl1', ownerId: 'u1', enabled: true },
      }),
    );
  });

  it('retries a failed delivery (ownership enforced)', async () => {
    const r = await retryDeliveryAction('pl1', 'd1');

    expect(r.ok).toBe(true);
    expect(mocks.deliverWebhook).toHaveBeenCalledWith('https://a', 'dec', {
      id: 'd1',
      event: 'server.power',
      server: '1a2b3c4d',
      actor: 'u1',
      data: { signal: 'restart' },
      retry: true,
    });
    expect(mocks.prisma.plugin.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'pl1', ownerId: 'u1', enabled: true },
      }),
    );
    expect(mocks.prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: { increment: 2 } }),
      }),
    );
  });
});
