# Pteron Panel — Client Slice 구현 계획 (Plan 3/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 실제로 쓰는 제품을 완성한다 — 디자인 시스템·앱 셸, 로그인(세션 발급), **스코프된 서버 목록**, 서버 개요+전원, **실시간 콘솔(Wings WebSocket 직결, xterm, 통계)**, 그리고 Playwright e2e(스코프 격리 검증)·Docker 배포·README.

**Architecture:** UI는 RSC + 소수 Client Component. 모든 데이터/변경은 `src/server/*` Server Actions를 통과(키·인가 적용). 콘솔만 브라우저가 Wings에 직접 붙되, 1회성 토큰은 Server Action `getConsoleCredentials`가 발급한다. 서버 뷰 탭은 **레지스트리 배열**로 렌더해 향후 플러그인 확장 지점을 만든다.

**Tech Stack:** Next 15(App Router, RSC + `useActionState`) · `@xterm/xterm` · `@playwright/test` · Tailwind v4. **선행:** Plan 1·2 완료(config/db/ptero/auth/authz/미들웨어/시드). 참조 spec: §10, §11, §14, §17.

> **표준 작업 규칙:** 각 Task 마지막에 **commit 후 `git push origin main`**. **AI 워터마크 금지**.

---

## File Structure (Plan 3 범위)

| 파일 | 책임 |
|---|---|
| `src/lib/utils.ts` | `cn()`(clsx+tailwind-merge) |
| `src/components/ui/{button,card,badge,input,status-badge}.tsx` | 디자인 시스템 기초 |
| `src/server/auth.ts` | `loginAction`/`logoutAction` |
| `src/app/(auth)/login/page.tsx` | 로그인 화면 |
| `src/app/(panel)/layout.tsx` | 앱 셸(내비·로그아웃) |
| `src/registry/server-tabs.ts` | 서버 뷰 탭 레지스트리(플러그인 seam) |
| `src/server/servers.ts` | `listMyServers`/`getServerOverview`/`powerServerAction` |
| `src/app/(panel)/servers/page.tsx` | 서버 목록 |
| `src/features/server-list/server-card.tsx` | 서버 카드 |
| `src/app/(panel)/servers/[id]/layout.tsx` | 서버 헤더 + 탭 + 접근 가드(404) |
| `src/app/(panel)/servers/[id]/page.tsx` | 개요 |
| `src/features/server-overview/power-controls.tsx` | 전원 버튼 |
| `src/server/console.ts` | `getConsoleCredentials` |
| `src/features/console/socket.ts` | WS 매니저(auth·갱신·재연결·4409) |
| `src/app/(panel)/servers/[id]/console/page.tsx` | 콘솔 UI(xterm+통계) |
| `playwright.config.ts`, `e2e/*` | e2e + mock Panel |
| `Dockerfile`, `docker-compose.yml`, `README.md` | 배포·문서 |

---

## Task 1: 디자인 시스템 기초

**Files:**
- Create: `src/lib/utils.ts`, `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/input.tsx`, `src/components/ui/status-badge.tsx`, `src/lib/utils.test.ts`

- [ ] **Step 1: `cn` 실패 테스트 작성**

`src/lib/utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges and dedupes tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', false && 'hidden', 'font-bold')).toBe('text-sm font-bold');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/utils.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: `cn` 구현**

`src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/utils.test.ts`
Expected: PASS.

- [ ] **Step 5: UI 컴포넌트 작성**

`src/components/ui/button.tsx`:
```tsx
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
  secondary: 'bg-zinc-200 text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-100',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
```

`src/components/ui/card.tsx`:
```tsx
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900', className)} {...props} />;
}
```

`src/components/ui/badge.tsx`:
```tsx
import { cn } from '@/lib/utils';

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)} {...props} />;
}
```

`src/components/ui/input.tsx`:
```tsx
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn('w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900', className)}
      {...props}
    />
  );
}
```

`src/components/ui/status-badge.tsx`:
```tsx
import { Badge } from './badge';

const colors: Record<string, string> = {
  running: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  starting: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  stopping: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  offline: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

export function StatusBadge({ state }: { state: string }) {
  return <Badge className={colors[state] ?? colors.offline}>{state}</Badge>;
}
```

- [ ] **Step 6: Commit + Push**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts src/components/ui/
git commit -m "feat(ui): design-system base (cn, Button, Card, Badge, Input, StatusBadge)"
git push origin main
```

---

## Task 2: 로그인/로그아웃 액션 + 로그인 화면

**Files:**
- Create: `src/server/auth.ts`, `src/app/(auth)/login/page.tsx`

> 액션은 `next/headers`·`next/navigation`·DB에 의존 → 단위 테스트 대신 Task 9 e2e로 검증.

- [ ] **Step 1: 인증 액션 작성**

`src/server/auth.ts`:
```ts
'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, destroySession } from '@/lib/auth/session';
import { setSessionCookie, clearSessionCookie, readSessionCookie } from '@/lib/auth/cookies';
import { audit } from '@/lib/audit';

const LoginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: '아이디와 비밀번호를 입력하세요.' };
  const { identifier, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier.toLowerCase() }] },
  });
  const ok = user && user.isActive ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !ok || !user.isActive) {
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim();
  const { token, expiresAt } = await createSession(user.id, { ip, userAgent: hdrs.get('user-agent') ?? undefined });
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
```

- [ ] **Step 2: 로그인 화면 작성**

`src/app/(auth)/login/page.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/server/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">Pteron Panel 로그인</h1>
        <form action={action} className="space-y-3">
          <Input name="identifier" placeholder="아이디 또는 이메일" autoComplete="username" />
          <Input name="password" type="password" placeholder="비밀번호" autoComplete="current-password" />
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? '로그인 중…' : '로그인'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 4: Commit + Push**

```bash
git add src/server/auth.ts "src/app/(auth)"
git commit -m "feat(auth-ui): login/logout actions + login page"
git push origin main
```

---

## Task 3: 앱 셸 레이아웃 (내비 + 로그아웃)

**Files:**
- Create: `src/app/(panel)/layout.tsx`

- [ ] **Step 1: 앱 셸 작성**

`src/app/(panel)/layout.tsx`:
```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/auth/current-user';
import { logoutAction } from '@/server/auth';
import { Button } from '@/components/ui/button';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="w-56 shrink-0 border-r border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-6 text-lg font-bold">Pteron</div>
        <nav className="space-y-1 text-sm">
          <Link href="/servers" className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">서버</Link>
          {user.role === 'ADMIN' && (
            <Link href="/admin" className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">관리자</Link>
          )}
          <Link href="/account" className="block rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">계정</Link>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <span className="text-sm text-zinc-500">{user.username}</span>
          <form action={logoutAction}>
            <Button variant="ghost" type="submit">로그아웃</Button>
          </form>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음. (`/admin`·`/account` 라우트는 후속 Phase. 링크만 존재.)

- [ ] **Step 3: Commit + Push**

```bash
git add "src/app/(panel)/layout.tsx"
git commit -m "feat(ui): authenticated app shell (nav + logout)"
git push origin main
```

---

## Task 4: 서버 뷰 탭 레지스트리 (플러그인 seam) [TDD]

**Files:**
- Create: `src/registry/server-tabs.ts`, `src/registry/server-tabs.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/registry/server-tabs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { serverTabs, registerServerTab } from './server-tabs';

describe('server tab registry', () => {
  it('ships overview and console built-ins', () => {
    const keys = serverTabs.map((t) => t.key);
    expect(keys).toContain('overview');
    expect(keys).toContain('console');
  });

  it('builds hrefs from an identifier', () => {
    const overview = serverTabs.find((t) => t.key === 'overview')!;
    expect(overview.href('1a2b3c4d')).toBe('/servers/1a2b3c4d');
  });

  it('registerServerTab appends and dedupes by key', () => {
    const before = serverTabs.length;
    registerServerTab({ key: 'plugin-x', label: 'X', href: (id) => `/servers/${id}/x` });
    registerServerTab({ key: 'plugin-x', label: 'X dup', href: (id) => `/servers/${id}/x` });
    expect(serverTabs.length).toBe(before + 1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/registry/server-tabs.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 3: 구현 작성**

`src/registry/server-tabs.ts`:
```ts
export interface ServerTab {
  key: string;
  label: string;
  href: (identifier: string) => string;
}

// Built-in tabs. Plugins (Phase 6) extend this via registerServerTab().
export const serverTabs: ServerTab[] = [
  { key: 'overview', label: '개요', href: (id) => `/servers/${id}` },
  { key: 'console', label: '콘솔', href: (id) => `/servers/${id}/console` },
];

export function registerServerTab(tab: ServerTab): void {
  if (!serverTabs.some((t) => t.key === tab.key)) serverTabs.push(tab);
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/registry/server-tabs.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit + Push**

```bash
git add src/registry/
git commit -m "feat(registry): server-view tab registry (plugin extension seam)"
git push origin main
```

---

## Task 5: 서버 목록 (액션 + 페이지 + 카드)

**Files:**
- Create: `src/server/servers.ts`, `src/app/(panel)/servers/page.tsx`, `src/features/server-list/server-card.tsx`

- [ ] **Step 1: 서버 액션 모듈 작성(목록 우선)**

`src/server/servers.ts`:
```ts
'use server';

import { requireUser } from '@/lib/auth/current-user';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { getServer, powerServer } from '@/lib/ptero/client';
import { asIdentifier, type AccessibleServer, type PowerSignal } from '@/lib/ptero/types';
import { audit } from '@/lib/audit';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser {
  return { id: u.id, role: u.role, pteroUserId: u.pteroUserId };
}

export async function listMyServers(): Promise<AccessibleServer[]> {
  const user = await requireUser();
  return resolveAccessibleServers(scope(user));
}

export async function getServerOverview(identifier: string) {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  const server = await requireServerAccess(scope(user), id); // throws ServerAccessDeniedError
  const details = await getServer(id);
  return { server, attributes: details.attributes };
}

export type PowerResult = { ok: true } | { ok: false; error: 'not_found' | 'failed' };

export async function powerServerAction(identifier: string, signal: PowerSignal): Promise<PowerResult> {
  const user = await requireUser();
  try {
    const id = asIdentifier(identifier);
    await requireServerAccess(scope(user), id);
    await powerServer(id, signal);
    await audit('server.power', { userId: user.id, target: id, metadata: { signal } });
    return { ok: true };
  } catch (err) {
    if (err instanceof ServerAccessDeniedError) return { ok: false, error: 'not_found' };
    console.error('powerServerAction failed', err);
    return { ok: false, error: 'failed' };
  }
}
```

- [ ] **Step 2: 서버 카드 작성**

`src/features/server-list/server-card.tsx`:
```tsx
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { AccessibleServer } from '@/lib/ptero/types';

export function ServerCard({ server }: { server: AccessibleServer }) {
  return (
    <Link href={`/servers/${server.identifier}`}>
      <Card className="transition-colors hover:border-indigo-400">
        <div className="font-medium">{server.name}</div>
        <div className="mt-1 text-xs text-zinc-500">{server.node ?? server.identifier}</div>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 3: 목록 페이지 작성**

`src/app/(panel)/servers/page.tsx`:
```tsx
import { listMyServers } from '@/server/servers';
import { ServerCard } from '@/features/server-list/server-card';

export default async function ServersPage() {
  const servers = await listMyServers();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">내 서버</h1>
      {servers.length === 0 ? (
        <p className="text-sm text-zinc-500">접근 가능한 서버가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((s) => (
            <ServerCard key={s.identifier} server={s} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 5: Commit + Push**

```bash
git add src/server/servers.ts "src/app/(panel)/servers/page.tsx" src/features/server-list/
git commit -m "feat(servers): scoped server list (action + page + card)"
git push origin main
```

---

## Task 6: 서버 개요 + 전원 (레이아웃·페이지·전원 버튼)

**Files:**
- Create: `src/app/(panel)/servers/[id]/layout.tsx`, `src/app/(panel)/servers/[id]/page.tsx`, `src/features/server-overview/power-controls.tsx`

- [ ] **Step 1: 서버 레이아웃(헤더 + 탭 + 접근 가드) 작성**

`src/app/(panel)/servers/[id]/layout.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess, ServerAccessDeniedError } from '@/lib/authz/guard';
import { asIdentifier } from '@/lib/ptero/types';
import { serverTabs } from '@/registry/server-tabs';

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  let name = id;
  try {
    const server = await requireServerAccess({ id: user.id, role: user.role, pteroUserId: user.pteroUserId }, asIdentifier(id));
    name = server.name;
  } catch (err) {
    if (err instanceof ServerAccessDeniedError) notFound();
    throw err;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">{name}</h1>
      <nav className="mt-3 mb-5 flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {serverTabs.map((t) => (
          <Link key={t.key} href={t.href(id)} className="px-3 py-2 text-sm hover:text-indigo-600">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: 전원 컨트롤(Client) 작성**

`src/features/server-overview/power-controls.tsx`:
```tsx
'use client';

import { useState, useTransition } from 'react';
import { powerServerAction } from '@/server/servers';
import { Button } from '@/components/ui/button';
import type { PowerSignal } from '@/lib/ptero/types';

const actions: Array<{ signal: PowerSignal; label: string; variant: 'primary' | 'secondary' | 'danger' }> = [
  { signal: 'start', label: '시작', variant: 'primary' },
  { signal: 'restart', label: '재시작', variant: 'secondary' },
  { signal: 'stop', label: '정지', variant: 'secondary' },
  { signal: 'kill', label: '강제종료', variant: 'danger' },
];

export function PowerControls({ identifier }: { identifier: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run(signal: PowerSignal) {
    setMsg(null);
    startTransition(async () => {
      const res = await powerServerAction(identifier, signal);
      if (!res.ok) setMsg(res.error === 'not_found' ? '서버를 찾을 수 없습니다.' : '작업에 실패했습니다.');
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {actions.map((a) => (
          <Button key={a.signal} variant={a.variant} disabled={pending} onClick={() => run(a.signal)}>
            {a.label}
          </Button>
        ))}
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 개요 페이지 작성**

`src/app/(panel)/servers/[id]/page.tsx`:
```tsx
import { getServerOverview } from '@/server/servers';
import { Card } from '@/components/ui/card';
import { PowerControls } from '@/features/server-overview/power-controls';

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { attributes } = await getServerOverview(id);
  const limits = (attributes.limits ?? {}) as Record<string, number>;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-medium">전원</h2>
        <PowerControls identifier={id} />
        <p className="mt-2 text-xs text-zinc-500">실시간 상태·통계는 콘솔 탭에서 확인하세요.</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">리소스 제한</h2>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-zinc-500">메모리</dt><dd>{limits.memory ?? '-'} MB</dd></div>
          <div><dt className="text-zinc-500">디스크</dt><dd>{limits.disk ?? '-'} MB</dd></div>
          <div><dt className="text-zinc-500">CPU</dt><dd>{limits.cpu ?? '-'} %</dd></div>
        </dl>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 5: Commit + Push**

```bash
git add "src/app/(panel)/servers/[id]/layout.tsx" "src/app/(panel)/servers/[id]/page.tsx" src/features/server-overview/
git commit -m "feat(servers): server overview + power controls with 404 access guard"
git push origin main
```

---

## Task 7: 콘솔 자격증명 액션 + WebSocket 매니저 [TDD]

**Files:**
- Create: `src/server/console.ts`, `src/features/console/socket.ts`, `src/features/console/socket.test.ts`

- [ ] **Step 1: 콘솔 자격증명 액션 작성**

`src/server/console.ts`:
```ts
'use server';

import { requireUser } from '@/lib/auth/current-user';
import { requireServerAccess } from '@/lib/authz/guard';
import { getWebsocketCredentials } from '@/lib/ptero/client';
import { asIdentifier, type WebsocketCredentials } from '@/lib/ptero/types';

export async function getConsoleCredentials(identifier: string): Promise<WebsocketCredentials> {
  const user = await requireUser();
  const id = asIdentifier(identifier);
  await requireServerAccess({ id: user.id, role: user.role, pteroUserId: user.pteroUserId }, id);
  return getWebsocketCredentials(id);
}
```

- [ ] **Step 2: WS 매니저 실패 테스트 작성**

`src/features/console/socket.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { ConsoleSocket, type ConsoleEvent } from './socket';

// Minimal fake WebSocket we can drive from tests.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  // test helpers
  open() {
    this.onopen?.();
  }
  emit(event: string, args: string[] = []) {
    this.onmessage?.({ data: JSON.stringify({ event, args }) });
  }
}

function setup(creds = { token: 'tok-1', socket: 'wss://node/api/servers/uuid/ws' }) {
  const events: ConsoleEvent[] = [];
  const getCredentials = vi.fn().mockResolvedValue(creds);
  const sock = new ConsoleSocket({
    getCredentials,
    onEvent: (e) => events.push(e),
    WebSocketImpl: FakeWebSocket as unknown as { new (url: string): WebSocket },
  });
  return { sock, events, getCredentials };
}

describe('ConsoleSocket', () => {
  it('authenticates with the token on open', async () => {
    const { sock } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    expect(JSON.parse(ws.sent[0])).toEqual({ event: 'auth', args: ['tok-1'] });
  });

  it('emits console + stats events', async () => {
    const { sock, events } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.emit('console output', ['hello']);
    ws.emit('stats', [JSON.stringify({ memory_bytes: 5, cpu_absolute: 1, disk_bytes: 9, network: { rx_bytes: 1, tx_bytes: 2 }, uptime: 10, state: 'running' })]);
    expect(events).toContainEqual({ type: 'console', line: 'hello' });
    expect(events.find((e) => e.type === 'stats')).toMatchObject({ type: 'stats', stats: { memory_bytes: 5, state: 'running' } });
  });

  it('refreshes the token on "token expiring"', async () => {
    const { sock, getCredentials } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    getCredentials.mockResolvedValueOnce({ token: 'tok-2', socket: 'wss://node/api/servers/uuid/ws' });
    ws.emit('token expiring');
    await vi.waitFor(() => {
      expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ event: 'auth', args: ['tok-2'] });
    });
  });

  it('sends commands and power signals', async () => {
    const { sock } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    sock.sendCommand('say hi');
    sock.setState('restart');
    expect(JSON.parse(ws.sent.at(-2)!)).toEqual({ event: 'send command', args: ['say hi'] });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ event: 'set state', args: ['restart'] });
  });

  it('does not reconnect after a 4409 (suspended) close', async () => {
    vi.useFakeTimers();
    const { sock, events } = setup();
    await sock.connect();
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.onclose?.({ code: 4409 });
    vi.advanceTimersByTime(20000);
    expect(events).toContainEqual({ type: 'close', code: 4409, suspended: true });
    expect(FakeWebSocket.instances).toHaveLength(1); // no new socket
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run src/features/console/socket.test.ts`
Expected: FAIL (모듈 미정의).

- [ ] **Step 4: WS 매니저 구현**

`src/features/console/socket.ts`:
```ts
import type { PowerSignal, WebsocketCredentials } from '@/lib/ptero/types';

export interface ConsoleStats {
  memory_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network: { rx_bytes: number; tx_bytes: number };
  uptime: number;
  state: string;
}

export type ConsoleEvent =
  | { type: 'open' }
  | { type: 'status'; status: string }
  | { type: 'console'; line: string }
  | { type: 'stats'; stats: ConsoleStats }
  | { type: 'daemon'; message: string }
  | { type: 'error'; message: string }
  | { type: 'close'; code: number; suspended: boolean };

interface WingsMessage {
  event: string;
  args?: string[];
}

type WsCtor = { new (url: string): WebSocket };

export interface ConsoleSocketDeps {
  getCredentials: () => Promise<WebsocketCredentials>;
  onEvent: (e: ConsoleEvent) => void;
  WebSocketImpl?: WsCtor;
}

export class ConsoleSocket {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private readonly WS: WsCtor;

  constructor(private readonly deps: ConsoleSocketDeps) {
    this.WS = deps.WebSocketImpl ?? (globalThis.WebSocket as unknown as WsCtor);
  }

  async connect(): Promise<void> {
    const creds = await this.deps.getCredentials();
    const ws = new this.WS(creds.socket);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.send('auth', [creds.token]);
      this.deps.onEvent({ type: 'open' });
    };
    ws.onmessage = (ev: MessageEvent) => this.handleMessage(typeof ev.data === 'string' ? ev.data : '');
    ws.onclose = (ev: CloseEvent) => this.handleClose(ev.code);
    ws.onerror = () => this.deps.onEvent({ type: 'error', message: 'WebSocket error' });
  }

  sendCommand(command: string): void {
    this.send('send command', [command]);
  }
  setState(signal: PowerSignal): void {
    this.send('set state', [signal]);
  }
  requestLogs(): void {
    this.send('send logs', []);
  }
  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  private send(event: string, args: string[]): void {
    this.ws?.send(JSON.stringify({ event, args }));
  }

  private async handleMessage(raw: string): Promise<void> {
    if (!raw) return;
    let msg: WingsMessage;
    try {
      msg = JSON.parse(raw) as WingsMessage;
    } catch {
      return;
    }
    const arg0 = msg.args?.[0] ?? '';
    switch (msg.event) {
      case 'auth success':
        break;
      case 'status':
        this.deps.onEvent({ type: 'status', status: arg0 });
        break;
      case 'console output':
        this.deps.onEvent({ type: 'console', line: arg0 });
        break;
      case 'stats':
        this.emitStats(arg0);
        break;
      case 'daemon message':
        this.deps.onEvent({ type: 'daemon', message: arg0 });
        break;
      case 'token expiring':
      case 'token expired':
        await this.refreshToken();
        break;
      case 'jwt error':
      case 'daemon error':
        this.deps.onEvent({ type: 'error', message: arg0 || 'daemon error' });
        break;
      default:
        break;
    }
  }

  private emitStats(json: string): void {
    try {
      const s = JSON.parse(json);
      this.deps.onEvent({
        type: 'stats',
        stats: {
          memory_bytes: s.memory_bytes ?? 0,
          cpu_absolute: s.cpu_absolute ?? 0,
          disk_bytes: s.disk_bytes ?? 0,
          network: { rx_bytes: s.network?.rx_bytes ?? 0, tx_bytes: s.network?.tx_bytes ?? 0 },
          uptime: s.uptime ?? 0,
          state: s.state ?? 'unknown',
        },
      });
    } catch {
      /* ignore malformed stats frame */
    }
  }

  private async refreshToken(): Promise<void> {
    try {
      const creds = await this.deps.getCredentials();
      this.send('auth', [creds.token]);
    } catch {
      this.deps.onEvent({ type: 'error', message: 'Failed to refresh console token' });
    }
  }

  private handleClose(code: number): void {
    const suspended = code === 4409;
    this.deps.onEvent({ type: 'close', code, suspended });
    if (this.closedByUser || suspended) return;
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    setTimeout(() => {
      if (!this.closedByUser) void this.connect();
    }, delay);
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run src/features/console/socket.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 6: Commit + Push**

```bash
git add src/server/console.ts src/features/console/socket.ts src/features/console/socket.test.ts
git commit -m "feat(console): websocket credentials action + WS manager (auth/refresh/reconnect/4409)"
git push origin main
```

---

## Task 8: 콘솔 UI (xterm + 통계 위젯)

**Files:**
- Create: `src/features/console/console-view.tsx`, `src/app/(panel)/servers/[id]/console/page.tsx`
- Modify: `package.json` (`@xterm/xterm`, `@xterm/addon-fit`)

- [ ] **Step 1: xterm 의존성 추가**

Run:
```bash
pnpm add @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: 콘솔 뷰(Client) 작성**

`src/features/console/console-view.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ConsoleSocket, type ConsoleStats } from './socket';
import { getConsoleCredentials } from '@/server/console';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function ConsoleView({ identifier }: { identifier: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<ConsoleSocket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const [stats, setStats] = useState<ConsoleStats | null>(null);
  const [status, setStatus] = useState<string>('connecting');
  const [command, setCommand] = useState('');

  useEffect(() => {
    const term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: '#09090b' } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (termRef.current) {
      term.open(termRef.current);
      fit.fit();
    }
    termInstance.current = term;

    const sock = new ConsoleSocket({
      getCredentials: () => getConsoleCredentials(identifier),
      onEvent: (e) => {
        switch (e.type) {
          case 'console': term.writeln(e.line); break;
          case 'status': setStatus(e.status); break;
          case 'stats': setStats(e.stats); setStatus(e.stats.state); break;
          case 'error': term.writeln(`\x1b[31m[error] ${e.message}\x1b[0m`); break;
          case 'close': setStatus(e.suspended ? 'suspended' : 'disconnected'); break;
        }
      },
    });
    socketRef.current = sock;
    void sock.connect().then(() => sock.requestLogs());

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      sock.close();
      term.dispose();
    };
  }, [identifier]);

  function submitCommand(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;
    socketRef.current?.sendCommand(trimmed);
    setCommand('');
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-zinc-500">상태:</span>
        <span>{status}</span>
        {stats && (
          <span className="text-zinc-500">
            CPU {stats.cpu_absolute.toFixed(1)}% · RAM {(stats.memory_bytes / 1048576).toFixed(0)}MB · DISK {(stats.disk_bytes / 1048576).toFixed(0)}MB
          </span>
        )}
      </div>
      <Card className="p-0">
        <div ref={termRef} className="h-[480px] w-full overflow-hidden rounded-lg" />
      </Card>
      <form onSubmit={submitCommand} className="flex gap-2">
        <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="콘솔 명령어 입력…" />
      </form>
    </div>
  );
}
```

- [ ] **Step 3: 콘솔 페이지 작성**

`src/app/(panel)/servers/[id]/console/page.tsx`:
```tsx
import { ConsoleView } from '@/features/console/console-view';

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 접근 가드는 부모 layout([id]/layout.tsx)의 requireServerAccess가 이미 강제함.
  return <ConsoleView identifier={id} />;
}
```

- [ ] **Step 4: 타입체크 + 빌드 스모크**

Run:
```bash
pnpm typecheck && pnpm build
```
Expected: 타입 그린, Next 빌드 성공.

- [ ] **Step 5: Commit + Push**

```bash
git add src/features/console/console-view.tsx "src/app/(panel)/servers/[id]/console/page.tsx" package.json pnpm-lock.yaml
git commit -m "feat(console): xterm console view with live stats + command input"
git push origin main
```

---

## Task 9: Playwright e2e — 로그인·스코프 격리 (mock Panel)

**Files:**
- Create: `playwright.config.ts`, `e2e/mock-panel.mjs`, `e2e/global-setup.ts`, `e2e/scope.spec.ts`
- Modify: `package.json` (`@playwright/test`, `e2e` script), `.env.test`

> e2e는 **mock Pterodactyl 서버**(`e2e/mock-panel.mjs`)와 **시드된 테스트 DB**에 대해 Next dev를 띄워 검증한다. 콘솔 실시간 스트리밍(실 Wings)은 단위 테스트(Task 7)로 커버하고, 여기선 로그인·스코프 격리·콘솔 페이지 렌더를 검증한다.

- [ ] **Step 1: Playwright 추가**

Run:
```bash
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```
`package.json` scripts에 추가:
```json
"e2e": "playwright test"
```

- [ ] **Step 2: mock Panel 서버 작성**

`e2e/mock-panel.mjs`:
```js
import { createServer } from 'node:http';

// 테스트 픽스처: USER(ptero id 7)는 server '1a2b3c4d'만 소유. ADMIN은 admin-all로 둘 다 본다.
const OWNED = {
  object: 'server',
  attributes: { id: 12, identifier: '1a2b3c4d', uuid: '1a2b3c4d-0000-4000-8000-000000000000', name: 'User Server' },
};
const OTHER = {
  object: 'server',
  attributes: { id: 13, identifier: '9z9z9z9z', uuid: '9z9z9z9z-0000-4000-8000-000000000000', name: 'Other Server' },
};
const list = (data) => ({ object: 'list', data, meta: { pagination: { total: data.length, count: data.length, per_page: 100, current_page: 1, total_pages: 1 } } });

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (obj, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const p = url.pathname;

  if (p === '/api/application/users' && url.searchParams.get('filter[email]') === 'user@example.com') {
    return json(list([{ object: 'user', attributes: { id: 7, uuid: 'u-7', email: 'user@example.com' } }]));
  }
  if (p === '/api/application/users/7') {
    return json({ object: 'user', attributes: { id: 7, relationships: { servers: list([OWNED]) } } });
  }
  if (p === '/api/client/' || p === '/api/client') {
    return json(list([OWNED, OTHER])); // admin-all
  }
  if (p === '/api/client/servers/1a2b3c4d') {
    return json({ object: 'server', attributes: { ...OWNED.attributes, limits: { memory: 1024, disk: 5120, cpu: 100 } } });
  }
  if (p === '/api/client/servers/1a2b3c4d/websocket') {
    return json({ data: { token: 'fake-jwt', socket: 'ws://127.0.0.1:65535/never' } });
  }
  return json({ errors: [{ code: 'NotFoundHttpException', status: '404', detail: 'mock: not found' }] }, 404);
});
server.listen(9099, () => console.log('mock-panel on :9099'));
```

- [ ] **Step 3: 글로벌 셋업(테스트 DB 마이그레이트 + 시드) 작성**

`.env.test`:
```bash
PANEL_URL="http://127.0.0.1:9099"
PTERO_APP_KEY="ptla_test"
PTERO_CLIENT_KEY="ptlc_test"
DATABASE_URL="postgresql://pteron:pteron@localhost:5432/pteron_e2e?schema=public"
SESSION_SECRET="e2e-session-secret-value"
APP_BASE_URL="http://127.0.0.1:3000"
SEED_ADMIN_EMAIL="admin@example.com"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="admin-pass"
SEED_USER_EMAIL="user@example.com"
SEED_USER_USERNAME="user"
SEED_USER_PASSWORD="user-pass"
```

`e2e/global-setup.ts`:
```ts
import { execSync } from 'node:child_process';

export default function globalSetup() {
  const env = { ...process.env };
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit', env });
  execSync('pnpm db:seed', { stdio: 'inherit', env });
}
```

- [ ] **Step 4: Playwright 설정 작성**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test' });

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: [
    { command: 'node e2e/mock-panel.mjs', port: 9099, reuseExistingServer: !process.env.CI },
    { command: 'pnpm dev', port: 3000, reuseExistingServer: !process.env.CI, env: { ...process.env } },
  ],
});
```

- [ ] **Step 5: 스코프 격리 스펙 작성**

`e2e/scope.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

async function login(page, id: string, pw: string) {
  await page.goto('/login');
  await page.fill('input[name="identifier"]', id);
  await page.fill('input[name="password"]', pw);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/servers');
}

test('USER sees only owned servers and cannot reach others', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await expect(page.getByText('User Server')).toBeVisible();
  await expect(page.getByText('Other Server')).toHaveCount(0);

  const res = await page.goto('/servers/9z9z9z9z'); // not owned
  expect(res?.status()).toBe(404);
});

test('ADMIN sees all servers', async ({ page }) => {
  await login(page, 'admin', 'admin-pass');
  await expect(page.getByText('User Server')).toBeVisible();
  await expect(page.getByText('Other Server')).toBeVisible();
});

test('console page renders the terminal for an accessible server', async ({ page }) => {
  await login(page, 'user', 'user-pass');
  await page.goto('/servers/1a2b3c4d/console');
  await expect(page.locator('.xterm')).toBeVisible();
});
```

- [ ] **Step 6: e2e 실행**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
createdb -h localhost -U pteron pteron_e2e || true   # 또는 psql로 생성
pnpm e2e
```
Expected: 3 e2e tests PASS. (DB 생성이 안 되면 `.env.test`의 `DATABASE_URL` DB를 먼저 만든다.)

- [ ] **Step 7: Commit + Push**

```bash
git add playwright.config.ts e2e/ package.json pnpm-lock.yaml .env.test
git commit -m "test(e2e): scope isolation + console render with mock Panel"
git push origin main
```

---

## Task 10: Docker 배포 + README

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `README.md`

- [ ] **Step 1: Dockerfile(멀티스테이지 standalone) 작성**

`Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`:
```
node_modules
.next
.git
.env
.env.*
e2e
docs
```

- [ ] **Step 2: 프로덕션 compose 작성**

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: pteron
      POSTGRES_PASSWORD: ${DB_PASSWORD:-pteron}
      POSTGRES_DB: pteron
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pteron"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    build: .
    command: ["pnpm", "prisma", "migrate", "deploy"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy

  app:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
    depends_on:
      migrate:
        condition: service_completed_successfully

volumes:
  pgdata:
```

> `migrate` 스테이지는 standalone 런타임에 pnpm/prisma CLI가 없을 수 있으므로, 운영에서는 별도 `migrate` 전용 이미지(빌드 스테이지 재사용) 또는 entrypoint 스크립트로 `prisma migrate deploy` 후 `node server.js` 실행을 권장. 단순화를 위해 위 compose는 빌드 이미지를 그대로 쓰되, 빌드 스테이지에 prisma CLI가 포함됨을 전제로 한다. (대안: `runner`에 `prisma` devDependency를 포함하거나 `migrate`만 `build` 타깃으로 빌드.)

- [ ] **Step 3: README 작성**

`README.md`:
```markdown
# Pteron Panel

Pterodactyl Panel을 **두 개의 API 키**(Application + root-admin Client)로 구동하는 멀티테넌트 커스텀 패널.

## 요구사항
- Pterodactyl Panel **1.11.x** + 노드별 Wings
- Docker / Docker Compose
- 두 개의 키:
  - **Application API Key** (`ptla_…`) — Admin → Application API. Users·Servers·Nodes 등 read 권한 부여.
  - **Client API Key** (`ptlc_…`) — **root admin 유저**의 Account → API Credentials.

## ⚠️ 필수: 각 노드 Wings 설정
콘솔은 브라우저가 Wings에 직접 WebSocket으로 붙는다. **콘솔을 쓸 모든 노드**의 `/etc/pterodactyl/config.yml`에 Pteron 도메인을 추가하고 Wings를 재시작한다:
```yaml
allowed_origins:
  - 'https://pteron.example.com'   # Pteron 패널의 정확한 origin (scheme+host+port)
```

## 설정
1. `.env` 작성:
   ```bash
   cp .env.example .env
   # PANEL_URL, PTERO_APP_KEY, PTERO_CLIENT_KEY, SESSION_SECRET, APP_BASE_URL,
   # SEED_ADMIN_*, SEED_USER_* 채우기
   ```
2. 기동:
   ```bash
   docker compose up -d --build
   docker compose run --rm app pnpm db:seed   # 초기 관리자 + 매핑된 테스트 유저
   ```
3. `http://localhost:3000` 접속 → 시드한 관리자 계정으로 로그인.

## 개발
```bash
corepack enable && pnpm install
docker compose -f docker-compose.dev.yml up -d db
cp .env.example .env
pnpm prisma migrate dev
pnpm dev
```

## 테스트
```bash
pnpm test                 # 단위(통합 제외하려면 --exclude '**/*.int.test.ts' --exclude '**/db.test.ts')
pnpm e2e                  # Playwright (mock Panel + 시드 DB)
```

## 아키텍처 / 로드맵
- 설계: `docs/superpowers/specs/2026-06-02-pteron-panel-design.md`
- 구현 계획: `docs/superpowers/plans/2026-06-02-pteron-panel-*.md`
- 현재 슬라이스: 기반 + 클라이언트(목록·개요·전원·콘솔). 다음: 파일·백업·관리자·**사용자 플러그인**(Phase 6).
```

- [ ] **Step 4: 빌드 검증**

Run:
```bash
docker compose build
```
Expected: 이미지 빌드 성공.

- [ ] **Step 5: Commit + Push**

```bash
git add Dockerfile docker-compose.yml .dockerignore README.md
git commit -m "feat(deploy): Dockerfile, compose, README (two keys + Wings allowed_origins)"
git push origin main
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§10, §11, §14):** 디자인 시스템/앱 셸(§11) ✓ T1,T3 · 로그인/세션 발급(§8,§10) ✓ T2 · 탭 레지스트리(§11,§17 seam) ✓ T4 · 스코프 서버 목록(§10.1) ✓ T5 · 개요+전원(§10.2–10.3) ✓ T6 · 콘솔 자격증명+WS 매니저·갱신·4409(§10.4) ✓ T7 · xterm 콘솔 UI(§10.4,§11) ✓ T8 · e2e 스코프 격리(§13,§18) ✓ T9 · Docker+Wings allowed_origins(§10.5,§14) ✓ T10.
- **플레이스홀더 스캔:** 모든 컴포넌트/액션/설정 실코드. UI는 e2e/수동 검증으로 명시.
- **타입 일관성:** `getConsoleCredentials`(server/console.ts) 반환 `WebsocketCredentials`를 `ConsoleSocket`이 소비. `powerServerAction`/`PowerResult` 시그니처가 `PowerControls`와 정합. `ScopeUser`(Plan 2) 생성 방식이 servers.ts/console.ts에서 동일. `serverTabs`(레지스트리)를 `[id]/layout.tsx`가 사용. `asIdentifier`로 라우트 파라미터 브랜딩 일관.
- **DoD(§18) 대응:** 로그인/세션 ✓T2, USER 소유만/타서버 404 ✓T9, ADMIN 전체 ✓T9, 개요·전원 ✓T6, 콘솔·갱신·4409 ✓T7/T8, 키 비노출(모든 호출 server 경유) ✓ 전반, WS 우선 라이브데이터 ✓ 콘솔, 테스트 그린 ✓ 각 Task, README/allowed_origins ✓T10.

---

## 전체 슬라이스 완료 후

세 계획(Plan 1·2·3)을 모두 실행하면 spec §18의 **첫 슬라이스 완료 기준**이 충족된다. 이후 로드맵 Phase 2(파일·백업) → Phase 3(관리자) → … → Phase 6(플러그인)으로, 각 Phase는 자체 spec→plan→구현 사이클을 가진다.
