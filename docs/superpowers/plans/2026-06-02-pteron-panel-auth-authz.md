# Pteron Panel — Auth & Authz 구현 계획 (Plan 2/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인증·인가 코어를 구축한다 — argon2 비밀번호 해시, **opaque 토큰 기반 DB 세션**, `requireUser()`/`requireAdmin()`, 라우트 보호 미들웨어, **멀티테넌트 스코프**(`resolveAccessibleServers` + TTL 캐시), **서버 접근 가드**(`requireServerAccess`), 그리고 시드(관리자 + 매핑된 테스트 유저).

**Architecture:** 세션은 32바이트 랜덤 토큰을 발급하고 **SHA-256 해시만 DB에 저장**(원문은 httpOnly 쿠키). 미들웨어는 Edge에서 쿠키 존재만 보고, 권위 검증은 Node 런타임의 `requireUser()`가 수행한다. 스코프는 로그인 유저의 역할/매핑으로 접근 가능 서버 집합을 해석(ADMIN=admin-all, USER=소유 서버)하고 짧은 TTL 캐시로 레이트리밋을 보호한다. 모든 서버 스코프 경로는 `requireServerAccess`로 가드한다.

**Tech Stack:** `@node-rs/argon2` · Node `crypto` · Prisma · Next 15 미들웨어/`next/headers`. **선행:** Plan 1 완료(`src/lib/config.ts`, `src/lib/db.ts`, `src/lib/ptero/*`). 참조 spec: §4, §8, §15.

> **표준 작업 규칙:** 각 Task 마지막에 **commit 후 `git push origin main`**. **AI 워터마크 금지**.
>
> **테스트 DB 주의:** 일부 Task는 로컬 Postgres 통합 테스트(`docker compose -f docker-compose.dev.yml up -d db`)가 필요하다. 순수 단위 테스트만 돌릴 땐 `pnpm vitest run --exclude '**/*.int.test.ts' --exclude '**/db.test.ts'`.

---

## File Structure (Plan 2 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/auth/constants.ts` | Edge-safe 상수(`SESSION_COOKIE`) — prisma import 금지 |
| `src/lib/auth/password.ts` | argon2id 해시/검증 |
| `src/lib/auth/session.ts` | 토큰 생성·해시, 세션 생성/검증/파기(DB) |
| `src/lib/auth/cookies.ts` | 세션 쿠키 set/clear (`next/headers`) |
| `src/lib/auth/current-user.ts` | `getCurrentUser`/`requireUser`/`requireAdmin` |
| `src/lib/audit.ts` | 감사 로그 기록 헬퍼 |
| `src/lib/cache.ts` | 제네릭 TTL 캐시 |
| `src/lib/authz/access.ts` | `resolveAccessibleServers` + 캐시 무효화 |
| `src/lib/authz/guard.ts` | `requireServerAccess` + `ServerAccessDeniedError` |
| `middleware.ts` | 라우트 보호(쿠키 존재 기반 리다이렉트) |
| `src/lib/ptero/application.ts`(수정) | `findUserByEmail` 추가 |
| `prisma/seed.ts` | 관리자 + 매핑된 테스트 유저 시드 |

---

## Task 1: 인증 상수 + 비밀번호 해시 (argon2id) [TDD]

**Files:**
- Create: `src/lib/auth/constants.ts`, `src/lib/auth/password.ts`, `src/lib/auth/password.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/auth/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies the correct password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 's3cret-pw')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-pw');
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/auth/password.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/lib/auth/constants.ts`:
```ts
// Edge-safe. MUST NOT import prisma or any Node-only module (used by middleware).
export const SESSION_COOKIE = 'pteron_session';
```

`src/lib/auth/password.ts`:
```ts
import { Algorithm, hash, verify } from '@node-rs/argon2';

const OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // ~19 MiB (OWASP argon2id baseline)
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verify(hashed, plain);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/auth/password.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/auth/constants.ts src/lib/auth/password.ts src/lib/auth/password.test.ts
git commit -m "feat(auth): argon2id password hashing + session cookie constant"
git push origin main
```

---

## Task 2: 세션 관리 (토큰 + DB) [TDD, 통합 DB]

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/session.int.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (통합 — 로컬 Postgres 필요)**

`src/lib/auth/session.int.test.ts`:
```ts
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
    // raw token is never stored — only its hash
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
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `docker compose -f docker-compose.dev.yml up -d db && pnpm vitest run src/lib/auth/session.int.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/lib/auth/session.ts`:
```ts
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
    data: { tokenHash, userId, expiresAt, ip: meta?.ip, userAgent: meta?.userAgent },
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/auth/session.int.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/auth/session.ts src/lib/auth/session.int.test.ts
git commit -m "feat(auth): opaque-token DB sessions (create/validate/destroy)"
git push origin main
```

---

## Task 3: 쿠키 헬퍼 + 현재 유저 (`requireUser`/`requireAdmin`)

> `next/headers`·`next/navigation`에 의존하는 얇은 I/O 계층. 단위 테스트 대신 **Plan 3의 Playwright e2e**로 검증한다(로그인→보호 페이지). 여기서는 정확한 구현만 둔다.

**Files:**
- Create: `src/lib/auth/cookies.ts`, `src/lib/auth/current-user.ts`

- [ ] **Step 1: 쿠키 헬퍼 작성**

`src/lib/auth/cookies.ts`:
```ts
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from './constants';

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionCookie(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
```

- [ ] **Step 2: 현재 유저 헬퍼 작성**

`src/lib/auth/current-user.ts`:
```ts
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
```

- [ ] **Step 3: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 4: Commit + Push**

```bash
git add src/lib/auth/cookies.ts src/lib/auth/current-user.ts
git commit -m "feat(auth): session cookie helpers + getCurrentUser/requireUser/requireAdmin"
git push origin main
```

---

## Task 4: 라우트 보호 미들웨어 [TDD]

**Files:**
- Create: `middleware.ts`, `src/middleware.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/middleware.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

function req(path: string, withCookie = false) {
  return new NextRequest(`http://localhost${path}`, {
    headers: withCookie ? { cookie: 'pteron_session=abc' } : {},
  });
}

describe('auth middleware', () => {
  it('redirects unauthenticated users to /login', () => {
    const res = middleware(req('/servers'));
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows authenticated users through', () => {
    const res = middleware(req('/servers', true));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects authenticated users away from /login', () => {
    const res = middleware(req('/login', true));
    expect(res.headers.get('location')).toContain('/servers');
  });

  it('allows unauthenticated access to /login', () => {
    const res = middleware(req('/login'));
    expect(res.headers.get('location')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/middleware.test.ts`
Expected: FAIL (`../middleware` 미정의).

- [ ] **Step 3: 구현 작성**

`middleware.ts` (프로젝트 루트):
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/constants';

const PUBLIC_PATHS = ['/login'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = req.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === '/login' && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/servers';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/middleware.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add middleware.ts src/middleware.test.ts
git commit -m "feat(auth): route-protection middleware (cookie presence redirect)"
git push origin main
```

---

## Task 5: 감사 로그 헬퍼 [TDD, 통합 DB]

**Files:**
- Create: `src/lib/audit.ts`, `src/lib/audit.int.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/audit.int.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { audit } from './audit';

describe('audit (integration)', () => {
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'test.action' } });
    await prisma.$disconnect();
  });

  it('records an audit log row', async () => {
    await audit('test.action', { target: 'srv-1', metadata: { a: 1 } });
    const row = await prisma.auditLog.findFirst({ where: { action: 'test.action' } });
    expect(row?.target).toBe('srv-1');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/audit.int.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/lib/audit.ts`:
```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function audit(
  action: string,
  opts: { userId?: string; target?: string; metadata?: Prisma.InputJsonValue; ip?: string } = {},
): Promise<void> {
  // Audit must never break the main flow; log-and-continue on failure.
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: opts.userId,
        target: opts.target,
        metadata: opts.metadata,
        ip: opts.ip,
      },
    });
  } catch (err) {
    console.error('audit log failed', { action, err });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/audit.int.test.ts`
Expected: 1 test PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/audit.ts src/lib/audit.int.test.ts
git commit -m "feat(audit): audit-log helper (log-and-continue)"
git push origin main
```

---

## Task 6: TTL 캐시 유틸 [TDD]

**Files:**
- Create: `src/lib/cache.ts`, `src/lib/cache.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/cache.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TtlCache } from './cache';

describe('TtlCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a stored value before expiry', () => {
    const c = new TtlCache<string, number>(1000);
    c.set('a', 42);
    expect(c.get('a')).toBe(42);
  });

  it('expires values after the TTL', () => {
    const c = new TtlCache<string, number>(1000);
    c.set('a', 42);
    vi.advanceTimersByTime(1001);
    expect(c.get('a')).toBeUndefined();
  });

  it('supports delete and clear', () => {
    const c = new TtlCache<string, number>(1000);
    c.set('a', 1);
    c.set('b', 2);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
    c.clear();
    expect(c.get('b')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/cache.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/lib/cache.ts`:
```ts
interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private store = new Map<K, Entry<V>>();
  constructor(private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/cache.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/cache.ts src/lib/cache.test.ts
git commit -m "feat(cache): generic TTL cache"
git push origin main
```

---

## Task 7: `application.findUserByEmail` [TDD]

**Files:**
- Modify: `src/lib/ptero/application.ts`
- Create: `src/lib/ptero/application.findUser.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/ptero/application.findUser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { findUserByEmail } from './application';

const BASE = 'https://panel.test/api/application';

describe('application.findUserByEmail', () => {
  it('returns {id, uuid} for a matching email', async () => {
    mswServer.use(
      http.get(`${BASE}/users`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('filter[email]')).toBe('a@b.com');
        return HttpResponse.json({
          object: 'list',
          data: [{ object: 'user', attributes: { id: 5, uuid: 'uuid-5', email: 'a@b.com' } }],
          meta: { pagination: { total: 1, count: 1, per_page: 50, current_page: 1, total_pages: 1 } },
        });
      }),
    );
    expect(await findUserByEmail('a@b.com')).toEqual({ id: 5, uuid: 'uuid-5' });
  });

  it('returns null when no user matches', async () => {
    mswServer.use(
      http.get(`${BASE}/users`, () =>
        HttpResponse.json({
          object: 'list',
          data: [],
          meta: { pagination: { total: 0, count: 0, per_page: 50, current_page: 1, total_pages: 1 } },
        }),
      ),
    );
    expect(await findUserByEmail('missing@b.com')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/ptero/application.findUser.test.ts`
Expected: FAIL (`findUserByEmail` 미정의).

- [ ] **Step 3: 구현 추가**

`src/lib/ptero/application.ts` 끝에 추가:
```ts
interface AppUserAttrs {
  id: number;
  uuid: string;
  email: string;
}

/** Find a Pterodactyl user by exact email (for mapping Pteron accounts). */
export async function findUserByEmail(email: string): Promise<{ id: number; uuid: string } | null> {
  const res = await pteroFetch<PteroList<AppUserAttrs>>('application', '/users', {
    query: { 'filter[email]': email },
  });
  const match = res.data.find(
    (u) => u.attributes.email.toLowerCase() === email.toLowerCase(),
  );
  return match ? { id: match.attributes.id, uuid: match.attributes.uuid } : null;
}
```

> `PteroList` 는 이미 `application.ts` 상단에서 import 됨(Plan 1). 빠져 있으면 `import { ... type PteroList } from './types';` 에 추가.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/ptero/application.findUser.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/ptero/application.ts src/lib/ptero/application.findUser.test.ts
git commit -m "feat(ptero): findUserByEmail for account mapping"
git push origin main
```

---

## Task 8: 스코프 해석 `resolveAccessibleServers` + 캐시 [TDD]

**Files:**
- Create: `src/lib/authz/access.ts`, `src/lib/authz/access.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/authz/access.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { resolveAccessibleServers, invalidateAccessCache } from './access';

const APP = 'https://panel.test/api/application';
const CLIENT = 'https://panel.test/api/client';

function listEnvelope(servers: Array<{ identifier: string; uuid: string; name: string; internal_id?: number }>) {
  return {
    object: 'list',
    data: servers.map((s) => ({ object: 'server', attributes: s })),
    meta: { pagination: { total: servers.length, count: servers.length, per_page: 100, current_page: 1, total_pages: 1 } },
  };
}

describe('resolveAccessibleServers', () => {
  beforeEach(() => invalidateAccessCache());

  it('ADMIN gets every server via client admin-all', async () => {
    mswServer.use(
      http.get(`${CLIENT}/`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('type')).toBe('admin-all');
        return HttpResponse.json(
          listEnvelope([{ identifier: 'aaaaaaaa', uuid: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'All', internal_id: 1 }]),
        );
      }),
    );
    const out = await resolveAccessibleServers({ id: 'u-admin', role: 'ADMIN', pteroUserId: null });
    expect(out.map((s) => s.identifier)).toEqual(['aaaaaaaa']);
  });

  it('USER gets only owned servers via application', async () => {
    mswServer.use(
      http.get(`${APP}/users/7`, () =>
        HttpResponse.json({
          object: 'user',
          attributes: {
            id: 7,
            relationships: {
              servers: listEnvelope([{ identifier: 'bbbbbbbb', uuid: 'bbbbbbbb-0000-4000-8000-000000000000', name: 'Mine', internal_id: 2 }]),
            },
          },
        }),
      ),
    );
    const out = await resolveAccessibleServers({ id: 'u-7', role: 'USER', pteroUserId: 7 });
    expect(out.map((s) => s.identifier)).toEqual(['bbbbbbbb']);
  });

  it('USER without mapping gets an empty set', async () => {
    const out = await resolveAccessibleServers({ id: 'u-x', role: 'USER', pteroUserId: null });
    expect(out).toEqual([]);
  });

  it('caches results (second call does not refetch)', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${CLIENT}/`, () => {
        calls += 1;
        return HttpResponse.json(listEnvelope([{ identifier: 'cccccccc', uuid: 'cccccccc-0000-4000-8000-000000000000', name: 'C' }]));
      }),
    );
    const user = { id: 'u-admin2', role: 'ADMIN' as const, pteroUserId: null };
    await resolveAccessibleServers(user);
    await resolveAccessibleServers(user);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/authz/access.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/lib/authz/access.ts`:
```ts
import { getOwnedServers } from '@/lib/ptero/application';
import { listServers } from '@/lib/ptero/client';
import type { AccessibleServer } from '@/lib/ptero/types';
import { TtlCache } from '@/lib/cache';

export interface ScopeUser {
  id: string;
  role: 'ADMIN' | 'USER';
  pteroUserId: number | null;
}

const cache = new TtlCache<string, AccessibleServer[]>(45_000); // 45s — protects the shared client rate-limit bucket

export async function resolveAccessibleServers(user: ScopeUser): Promise<AccessibleServer[]> {
  const hit = cache.get(user.id);
  if (hit) return hit;

  let servers: AccessibleServer[];
  if (user.role === 'ADMIN') {
    servers = await listServers('admin-all');
  } else if (user.pteroUserId != null) {
    servers = await getOwnedServers(user.pteroUserId);
  } else {
    servers = [];
  }

  cache.set(user.id, servers);
  return servers;
}

export function invalidateAccessCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/authz/access.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/authz/access.ts src/lib/authz/access.test.ts
git commit -m "feat(authz): resolveAccessibleServers with role-based scope + TTL cache"
git push origin main
```

---

## Task 9: 서버 접근 가드 `requireServerAccess` [TDD]

**Files:**
- Create: `src/lib/authz/guard.ts`, `src/lib/authz/guard.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/authz/guard.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { requireServerAccess, ServerAccessDeniedError } from './guard';
import { invalidateAccessCache } from './access';

const CLIENT = 'https://panel.test/api/client';

beforeEach(() => invalidateAccessCache());

function adminList() {
  mswServer.use(
    http.get(`${CLIENT}/`, () =>
      HttpResponse.json({
        object: 'list',
        data: [{ object: 'server', attributes: { identifier: '1a2b3c4d', uuid: '1a2b3c4d-0000-4000-8000-000000000000', name: 'A' } }],
        meta: { pagination: { total: 1, count: 1, per_page: 100, current_page: 1, total_pages: 1 } },
      }),
    ),
  );
}

describe('requireServerAccess', () => {
  it('returns the server when the user can access it', async () => {
    adminList();
    const s = await requireServerAccess({ id: 'a', role: 'ADMIN', pteroUserId: null }, '1a2b3c4d');
    expect(s.name).toBe('A');
  });

  it('throws ServerAccessDeniedError when the user cannot', async () => {
    adminList();
    await expect(
      requireServerAccess({ id: 'a', role: 'ADMIN', pteroUserId: null }, 'deadbeef'),
    ).rejects.toBeInstanceOf(ServerAccessDeniedError);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/lib/authz/guard.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/lib/authz/guard.ts`:
```ts
import type { AccessibleServer } from '@/lib/ptero/types';
import { resolveAccessibleServers, type ScopeUser } from './access';

/** Thrown when a user requests a server outside their scope. Map to HTTP 404 (existence hiding). */
export class ServerAccessDeniedError extends Error {
  constructor(readonly identifier: string) {
    super('The requested server could not be found.');
    this.name = 'ServerAccessDeniedError';
  }
}

export async function requireServerAccess(
  user: ScopeUser,
  identifier: string,
): Promise<AccessibleServer> {
  const servers = await resolveAccessibleServers(user);
  const match = servers.find((s) => s.identifier === identifier);
  if (!match) throw new ServerAccessDeniedError(identifier);
  return match;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/lib/authz/guard.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/lib/authz/guard.ts src/lib/authz/guard.test.ts
git commit -m "feat(authz): requireServerAccess guard (404 existence hiding)"
git push origin main
```

---

## Task 10: 시드 스크립트 (관리자 + 매핑된 테스트 유저)

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (devDependency `dotenv`), `.env.example` (시드 변수)

- [ ] **Step 1: dotenv 추가 + 시드 환경 변수 문서화**

Run:
```bash
pnpm add -D dotenv
```

`.env.example` 끝에 추가:
```bash
# Seed (prisma db:seed)
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="change-me-admin"
SEED_USER_EMAIL="user@example.com"          # 반드시 Pterodactyl에 존재하는 유저 이메일
SEED_USER_USERNAME="user"
SEED_USER_PASSWORD="change-me-user"
```

- [ ] **Step 2: 시드 스크립트 작성**

`prisma/seed.ts`:
```ts
import 'dotenv/config';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { findUserByEmail } from '@/lib/ptero/application';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required seed env: ${name}`);
  return v;
}

async function upsertAdmin() {
  const email = req('SEED_ADMIN_EMAIL');
  const passwordHash = await hashPassword(req('SEED_ADMIN_PASSWORD'));
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', passwordHash, isActive: true },
    create: { email, username: req('SEED_ADMIN_USERNAME'), passwordHash, role: 'ADMIN' },
  });
  console.log(`✓ admin ready: ${admin.email}`);
}

async function upsertMappedUser() {
  const email = req('SEED_USER_EMAIL');
  const passwordHash = await hashPassword(req('SEED_USER_PASSWORD'));
  const mapping = await findUserByEmail(email);
  if (!mapping) {
    console.warn(`! No Pterodactyl user found for ${email}; creating USER without mapping (will see no servers).`);
  }
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'USER', passwordHash, isActive: true, pteroUserId: mapping?.id, pteroUuid: mapping?.uuid },
    create: {
      email,
      username: req('SEED_USER_USERNAME'),
      passwordHash,
      role: 'USER',
      pteroUserId: mapping?.id,
      pteroUuid: mapping?.uuid,
    },
  });
  console.log(`✓ user ready: ${user.email} (pteroUserId=${user.pteroUserId ?? 'unmapped'})`);
}

async function main() {
  await upsertAdmin();
  await upsertMappedUser();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

> `prisma/seed.ts` 가 `@/` alias를 쓰므로 `tsx`가 `tsconfig.json`의 paths를 해석한다(tsx는 기본 지원). 동작 안 하면 `import { prisma } from '../src/lib/db'` 식 상대경로로 교체.

- [ ] **Step 3: 시드 실행·검증**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate deploy
pnpm db:seed
```
Expected: `✓ admin ready` 와 `✓ user ready` 출력. (Pterodactyl `SEED_USER_EMAIL` 이 실제 존재하면 `pteroUserId=<숫자>`.)

검증:
```bash
pnpm prisma studio   # User 테이블에 admin/user 2행, role·pteroUserId 확인
```

- [ ] **Step 4: 전체 단위 테스트·타입·린트 게이트**

Run:
```bash
pnpm vitest run --exclude '**/*.int.test.ts' --exclude '**/db.test.ts' && pnpm typecheck && pnpm lint
```
Expected: 모든 단위 테스트 PASS, 타입·린트 그린. (통합 테스트는 Postgres 가동 시 `pnpm vitest run` 전체로.)

- [ ] **Step 5: Commit + Push**

```bash
git add prisma/seed.ts package.json pnpm-lock.yaml .env.example
git commit -m "feat(seed): admin + Pterodactyl-mapped test user seeding"
git push origin main
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§4, §8, §15):** argon2 해시(§8.1) ✓ T1 · opaque DB 세션·취소·만료·isActive(§8.1, §15) ✓ T2 · requireUser/requireAdmin(§8) ✓ T3 · 미들웨어(§8.1) ✓ T4 · 감사 로그(§15) ✓ T5 · TTL 캐시(§4.3) ✓ T6 · 매핑 메커니즘(§8.2) ✓ T7 · resolveAccessibleServers ADMIN/USER/미매핑·캐시(§4.1, §4.4) ✓ T8 · requireServerAccess 404 은닉(§4.2) ✓ T9 · 시드(§8.2) ✓ T10.
- **플레이스홀더 스캔:** 모든 코드/명령 실측. TBD 없음.
- **타입 일관성:** `ScopeUser`(access.ts)를 guard.ts가 재사용. `SESSION_COOKIE`는 `constants.ts` 단일 정의(session.ts 재export, middleware는 constants에서 직접 import → Edge에 prisma 유입 없음). `validateSessionToken` 반환형 `Session & {user}` 일관. `AccessibleServer`(Plan 1)와 정합.
- **Edge 안전성:** middleware는 `@/lib/auth/constants`만 import(prisma 없음). ✓
- **환경 의존:** `*.int.test.ts`/`db.test.ts`는 로컬 Postgres 필요(게이트에서 제외 옵션 제공).

---

## 다음 계획

- **Plan 3 — Client Slice:** 디자인 시스템·앱 셸, 로그인 페이지+액션(세션 발급), 서버 목록(스코프), 서버 개요+전원, **콘솔(WS 매니저 + xterm + 통계)**, Playwright e2e(로그인→목록→콘솔→스코프 격리), Dockerfile/compose(full), README(두 키·Wings `allowed_origins`·배포).
