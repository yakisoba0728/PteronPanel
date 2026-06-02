'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '@/lib/auth/cookies';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';

const LoginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_FAILURES = 5;

interface LoginAttempt {
  count: number;
  firstFailedAt: number;
}

const globalForLoginAttempts = globalThis as unknown as {
  pteronLoginAttempts?: Map<string, LoginAttempt>;
};

const loginAttempts =
  globalForLoginAttempts.pteronLoginAttempts ?? new Map<string, LoginAttempt>();
globalForLoginAttempts.pteronLoginAttempts = loginAttempts;

export interface LoginState {
  error?: string;
}

function attemptKey(identifier: string, ip?: string): string {
  return `${ip ?? 'unknown'}:${identifier.toLowerCase()}`;
}

function isLoginLimited(key: string): boolean {
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (Date.now() - attempt.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstFailedAt: now });
    return;
  }
  current.count += 1;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: '아이디와 비밀번호를 입력하세요.' };

  const { identifier, password } = parsed.data;
  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim();
  const key = attemptKey(identifier, ip);
  if (isLoginLimited(key)) {
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
    },
  });
  const ok = user && user.isActive ? await verifyPassword(user.passwordHash, password) : false;

  if (!user || !ok || !user.isActive) {
    recordLoginFailure(key);
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  loginAttempts.delete(key);
  const { token, expiresAt } = await createSession(user.id, {
    ip,
    userAgent: hdrs.get('user-agent') ?? undefined,
  });
  await setSessionCookie(token, expiresAt);
  await audit('auth.login', { userId: user.id, ip });

  redirect('/servers');
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionCookie();
  if (token) await destroySession(token);
  await clearSessionCookie();

  redirect('/login');
}
