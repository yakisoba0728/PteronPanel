import { createHmac, randomBytes } from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';

export { SESSION_COOKIE } from './constants';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

// Keyed (HMAC) hash of the session token so that the value stored in the DB is
// not a bare SHA-256 of the token: a read-only DB leak alone cannot be used to
// forge a session-token lookup without also knowing SESSION_SECRET.
export function hashToken(token: string): string {
  return createHmac('sha256', getConfig().SESSION_SECRET).update(token).digest('hex');
}

export async function createSession(
  userId: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const ttlHours = getConfig().SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });

  return { token, expiresAt };
}

export async function validateSessionToken(
  token: string,
): Promise<(Session & { user: User }) | null> {
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (!session.user.isActive) return null;

  // Sliding expiry, but throttled: only refresh lastSeenAt/expiresAt once the
  // session is past the halfway point of its TTL. This avoids a DB write on
  // every single authenticated request while still keeping active sessions
  // alive well before they expire.
  const ttlMs = getConfig().SESSION_TTL_HOURS * 3_600_000;
  if (session.expiresAt.getTime() - Date.now() < ttlMs / 2) {
    const now = new Date();
    const updated = await prisma.session.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    });
    return { ...updated, user: session.user };
  }

  return { ...session };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
