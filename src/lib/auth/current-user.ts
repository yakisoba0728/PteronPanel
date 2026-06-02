import { redirect } from 'next/navigation';
import type { User } from '@prisma/client';
import { readSessionCookie } from './cookies';
import { validateSessionToken } from './session';

export async function getCurrentUser(): Promise<User | null> {
  const token = await readSessionCookie();
  if (!token) return null;
  const session = await validateSessionToken(token);
  return session?.user ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') redirect('/servers');
  return user;
}
