import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { hashToken, createSession, validateSessionToken, destroySession } from './session';

async function makeUser(over: Partial<{ isActive: boolean }> = {}) {
  return prisma.user.create({
    data: {
      email: `sess-${Math.random().toString(36).slice(2)}@x.com`,
      username: `sess-${Math.random().toString(36).slice(2)}`,
      passwordHash: 'x',
      isActive: over.isActive ?? true,
    },
  });
}

describe('session management (integration)', () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
  });

  afterAll(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany({ where: { email: { contains: 'sess-' } } });
    await prisma.$disconnect();
  });

  it('creates a session and validates the token', async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    const session = await validateSessionToken(token);
    expect(session?.user.id).toBe(user.id);
    const row = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(row).not.toBeNull();
  });

  it('returns null for an unknown token', async () => {
    expect(await validateSessionToken('nope')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
  });

  it('rejects sessions of inactive users', async () => {
    const user = await makeUser({ isActive: false });
    const { token } = await createSession(user.id);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it('destroys a session', async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    await destroySession(token);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it('slides expiry and updates lastSeenAt when past half of the TTL', async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    const oldLastSeenAt = new Date(Date.now() - 3_600_000);
    // Near expiry (well under half of the 12h default TTL remaining).
    const oldExpiresAt = new Date(Date.now() + 60_000);
    await prisma.session.updateMany({
      data: { lastSeenAt: oldLastSeenAt, expiresAt: oldExpiresAt },
    });

    const session = await validateSessionToken(token);
    expect(session?.lastSeenAt.getTime()).toBeGreaterThan(oldLastSeenAt.getTime());
    expect(session?.expiresAt.getTime()).toBeGreaterThan(oldExpiresAt.getTime());
  });

  it('does not write when more than half of the TTL remains', async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id);
    const oldLastSeenAt = new Date(Date.now() - 3_600_000);
    // Plenty of TTL remaining (default TTL is 12h, so half is 6h).
    const oldExpiresAt = new Date(Date.now() + 11 * 3_600_000);
    await prisma.session.updateMany({
      data: { lastSeenAt: oldLastSeenAt, expiresAt: oldExpiresAt },
    });

    const session = await validateSessionToken(token);
    expect(session).not.toBeNull();
    // The throttle should have skipped the write: timestamps are unchanged.
    expect(session?.lastSeenAt.getTime()).toBe(oldLastSeenAt.getTime());
    expect(session?.expiresAt.getTime()).toBe(oldExpiresAt.getTime());

    const row = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    expect(row?.lastSeenAt.getTime()).toBe(oldLastSeenAt.getTime());
    expect(row?.expiresAt.getTime()).toBe(oldExpiresAt.getTime());
  });
});
