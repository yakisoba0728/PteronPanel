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

// A pre-computed, valid argon2id hash (of a throwaway value) used to pay the
// full KDF verification cost on login paths where the user is absent or
// inactive. This keeps the timing of every login attempt roughly constant and
// prevents user-enumeration via response latency.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$JFsOl6W8On3Xjs8Fo2ih8A$/+gcwUwnnadMMdcaIW5ga+dtmX2+Jgz3V6qCicXtC6Y';

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

// Key the brute-force limiter on the account identifier, NOT on the client IP.
// The IP is derived from `X-Forwarded-For`, which is trivially spoofable unless
// a trusted proxy is configured, so an IP-keyed limiter can be bypassed simply
// by rotating the XFF header. Keying on the (lowercased) account identifier
// closes that bypass.
//
// Tradeoff: this enables a targeted account-lockout DoS — an attacker who knows
// a username can lock that account out for LOGIN_WINDOW_MS by submitting bad
// passwords. For an MVP this is an acceptable price for resisting trivial
// password-spraying; a production deployment should layer on per-IP limits
// behind a trusted proxy and/or CAPTCHA. The limiter is in-memory and
// therefore PER INSTANCE only (single-instance MVP); it does not coordinate
// across replicas.
function attemptKey(identifier: string): string {
  return identifier.toLowerCase();
}

function isLoginLimited(key: string): boolean {
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (Date.now() - attempt.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  // Block once we have reached LOGIN_MAX_FAILURES failures within the window.
  // recordLoginFailure caps the stored count at LOGIN_MAX_FAILURES, so the Nth
  // failed attempt makes the (N+1)th attempt the first one rejected.
  return attempt.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.firstFailedAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstFailedAt: now });
    return;
  }
  if (current.count < LOGIN_MAX_FAILURES) current.count += 1;
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
  // NOTE: `x-forwarded-for` is untrusted unless a trusted reverse proxy is
  // configured to set it. We record it in the audit log for forensics but do
  // NOT use it for the brute-force limiter (see attemptKey above).
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim();
  const key = attemptKey(identifier);
  if (isLoginLimited(key)) {
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ username: identifier }, { email: identifier.toLowerCase() }],
    },
  });

  // Always pay the full argon2 verification cost, even when the user is missing
  // or inactive, so login latency does not leak whether an account exists or is
  // active. Verify against a fixed dummy hash on those paths, then branch only
  // after the KDF has run.
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

  if (!user || !user.isActive || !ok) {
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
