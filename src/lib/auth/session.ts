import { createHash, randomBytes } from 'node:crypto';
import type { Session, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getConfig } from '@/lib/config';

export { SESSION_COOKIE } from './constants';

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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

  return session;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function destroyAllUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
