import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deliverMock, prismaMock, resolveMock } = vi.hoisted(() => {
  const prisma = {
    plugin: { findMany: vi.fn() },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        role: 'USER',
        pteroUserId: where.id === 'u1' ? 7 : 8,
      })),
    },
    webhookDelivery: {
      create: vi.fn(async () => ({ id: 'd1' })),
      update: vi.fn(async () => ({})),
    },
  };
  return {
    deliverMock: vi.fn(async () => ({ ok: true, status: 200 })),
    prismaMock: prisma,
    resolveMock: vi.fn(),
  };
});
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/authz/access', () => ({ resolveAccessibleServers: resolveMock }));
vi.mock('./webhook', () => ({
  deliverWebhook: deliverMock,
  signWebhook: () => 'sig',
}));
vi.mock('@/lib/crypto', () => ({ decryptSecret: (s: string) => `dec:${s}` }));

import { selectTargetPlugins } from './events';

beforeEach(() => vi.clearAllMocks());

describe('selectTargetPlugins', () => {
  it('includes only subscribed+enabled+webhook plugins whose owner can access the server', async () => {
    prismaMock.plugin.findMany.mockResolvedValue([
      {
        id: 'p1',
        ownerId: 'u1',
        webhookUrl: 'https://a',
        webhookSecretEnc: 'e1',
        events: ['server.power'],
      },
      {
        id: 'p2',
        ownerId: 'u2',
        webhookUrl: 'https://b',
        webhookSecretEnc: 'e2',
        events: ['server.power'],
      },
    ]);
    resolveMock.mockImplementation(async (owner: { id: string }) =>
      owner.id === 'u1'
        ? [{ identifier: '1a2b3c4d' }]
        : [{ identifier: 'zzzzzzzz' }],
    );

    const targets = await selectTargetPlugins('server.power', '1a2b3c4d');

    expect(targets.map((t) => t.id)).toEqual(['p1']);
  });
});
