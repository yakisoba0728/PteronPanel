# Pteron Panel — Polish & Hardening 구현 계획 (Phase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 기능 완성 후 마감·강화 — **토스트 알림**, **다크/라이트 테마 토글**, **i18n 골격(한/영)**, **권한 인지 서버 탭 내비**, **대시보드(개요)**, 그리고 하드닝: **글로벌 에러/404 바운더리**, **429·에러 UX**, **보안 헤더·헬스체크·프로덕션 검증**.

**Architecture:** UI 폴리시는 기존 컴포넌트/레이아웃에 얹는다(토스트 Provider를 `(panel)` 레이아웃에, 테마/언어는 쿠키 기반으로 SSR 플래시 없이). 권한 인지 내비는 서버 뷰 `layout.tsx`가 `requireServerAccess` 결과의 `accessKind`/`permissions`로 `serverTabs`를 필터(소유자/관리자는 전부, 서브유저는 보유 권한 탭만; 권한 미지정 탭은 항상 노출 — 안전 우선). 하드닝은 `next.config`/route handler/error 컴포넌트.

**Tech Stack:** 기존 스택. **선행:** Phase 1–4 완료. 참조 spec: §11(UI/UX·i18n·테마), §12(에러), §14(배포), §15(보안), 그리고 Phase 4b/4c 리뷰의 이연 항목(권한 인지 내비·권한 화이트리스트).

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure (Phase 5 범위)

| 파일 | 책임 |
|---|---|
| `src/components/toast/*` | 토스트 Provider·훅·Toaster |
| `src/lib/theme.ts`, `src/components/theme-toggle.tsx` | 쿠키 기반 테마 |
| `src/lib/i18n/*`, `src/components/locale-switcher.tsx` | i18n 골격(ko/en) |
| `src/registry/server-tabs.ts`(수정), `src/lib/authz/visible-tabs.ts` | 권한 인지 탭 |
| `src/server/dashboard.ts`, `src/app/(panel)/page.tsx`, `src/features/dashboard/*` | 대시보드 |
| `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/(panel)/error.tsx` | 에러/404 바운더리 |
| `next.config.mjs`(수정), `src/app/api/health/route.ts` | 보안 헤더·헬스체크 |
| `README.md`(수정) | 운영·보안 섹션 |

---

## Task 1: 토스트 알림 시스템

**Files:**
- Create: `src/components/toast/toast-provider.tsx`, `src/components/toast/use-toast.ts`
- Modify: `src/app/(panel)/layout.tsx`

- [ ] **Step 1: Provider + 훅 작성**

`src/components/toast/toast-provider.tsx`:
```tsx
'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error' };
const ToastCtx = createContext<{ push: (m: string, k?: Toast['kind']) => void } | null>(null);

let counter = 0;
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = (counter += 1);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-md px-4 py-2 text-sm text-white shadow-lg ${t.kind === 'error' ? 'bg-red-600' : t.kind === 'success' ? 'bg-green-600' : 'bg-zinc-800'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToastCtx() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
```

`src/components/toast/use-toast.ts`:
```ts
'use client';
import { useToastCtx } from './toast-provider';
export function useToast() { return useToastCtx().push; }
```

- [ ] **Step 2: 레이아웃에 Provider 장착**

`src/app/(panel)/layout.tsx` 의 반환 JSX 최상위를 `<ToastProvider>`로 감싼다(`import { ToastProvider } from '@/components/toast/toast-provider';`).

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/components/toast/ "src/app/(panel)/layout.tsx"
git commit -m "feat(ui): toast notification system"
git push
```

> 후속(선택): 각 feature view의 `alert()`/인라인 msg를 `useToast()`로 점진 교체. 이번 Task는 시스템 도입까지.

---

## Task 2: 다크/라이트 테마 토글 (쿠키, SSR 플래시 없음)

**Files:**
- Create: `src/lib/theme.ts`, `src/components/theme-toggle.tsx`, `src/app/api/theme/route.ts`
- Modify: `src/app/layout.tsx`, `src/app/(panel)/layout.tsx`

- [ ] **Step 1: 테마 헬퍼 + 라우트**

`src/lib/theme.ts`:
```ts
import { cookies } from 'next/headers';
export type Theme = 'light' | 'dark';
export async function getTheme(): Promise<Theme> {
  return (await cookies()).get('theme')?.value === 'dark' ? 'dark' : 'light';
}
```

`src/app/api/theme/route.ts`:
```ts
import { NextResponse } from 'next/server';
export async function POST(req: Request) {
  const { theme } = await req.json();
  const res = NextResponse.json({ ok: true });
  res.cookies.set('theme', theme === 'dark' ? 'dark' : 'light', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
```

- [ ] **Step 2: 루트 레이아웃에서 테마 클래스 적용**

`src/app/layout.tsx`: `getTheme()`로 `<html className={theme}>` 설정(서버 렌더 → 플래시 없음).
```tsx
import { getTheme } from '@/lib/theme';
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();
  return (<html lang="ko" className={theme}><body>{children}</body></html>);
}
```

- [ ] **Step 3: 토글 컴포넌트 + 상단바 배치**

`src/components/theme-toggle.tsx`:
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export function ThemeToggle() {
  const router = useRouter();
  async function toggle() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    await fetch('/api/theme', { method: 'POST', body: JSON.stringify({ theme: next }) });
    router.refresh();
  }
  return <Button variant="ghost" onClick={toggle} aria-label="테마 전환">🌓</Button>;
}
```
`(panel)/layout.tsx` 상단바에 `<ThemeToggle />` 추가.

- [ ] **Step 4: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/lib/theme.ts src/components/theme-toggle.tsx src/app/api/theme/ src/app/layout.tsx "src/app/(panel)/layout.tsx"
git commit -m "feat(ui): cookie-based dark/light theme toggle (no SSR flash)"
git push
```

---

## Task 3: i18n 골격 (한/영)

**Files:**
- Create: `src/lib/i18n/dictionaries.ts`, `src/lib/i18n/index.ts`, `src/lib/i18n/i18n.test.ts`, `src/components/locale-switcher.tsx`, `src/app/api/locale/route.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/i18n/i18n.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { translate } from './index';

describe('translate', () => {
  it('returns the string for the locale', () => {
    expect(translate('ko', 'nav.servers')).toBe('서버');
    expect(translate('en', 'nav.servers')).toBe('Servers');
  });
  it('falls back to the key when missing', () => {
    expect(translate('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
});
```

- [ ] **Step 2: 구현**

`src/lib/i18n/dictionaries.ts`:
```ts
export const dictionaries = {
  ko: { 'nav.servers': '서버', 'nav.admin': '관리자', 'nav.account': '계정', 'action.logout': '로그아웃', 'common.loading': '불러오는 중…' },
  en: { 'nav.servers': 'Servers', 'nav.admin': 'Admin', 'nav.account': 'Account', 'action.logout': 'Log out', 'common.loading': 'Loading…' },
} as const;
export type Locale = keyof typeof dictionaries;
export type MessageKey = keyof (typeof dictionaries)['ko'];
```

`src/lib/i18n/index.ts`:
```ts
import { cookies } from 'next/headers';
import { dictionaries, type Locale } from './dictionaries';

export function translate(locale: Locale, key: string): string {
  const dict = dictionaries[locale] as Record<string, string>;
  return dict[key] ?? key;
}
export async function getLocale(): Promise<Locale> {
  return (await cookies()).get('locale')?.value === 'en' ? 'en' : 'ko';
}
```

`src/app/api/locale/route.ts`:
```ts
import { NextResponse } from 'next/server';
export async function POST(req: Request) {
  const { locale } = await req.json();
  const res = NextResponse.json({ ok: true });
  res.cookies.set('locale', locale === 'en' ? 'en' : 'ko', { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  return res;
}
```

`src/components/locale-switcher.tsx`:
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
export function LocaleSwitcher() {
  const router = useRouter();
  async function set(locale: 'ko' | 'en') { await fetch('/api/locale', { method: 'POST', body: JSON.stringify({ locale }) }); router.refresh(); }
  return (
    <div className="flex gap-1 text-xs">
      <button onClick={() => set('ko')} className="hover:underline">한</button>
      <span className="text-zinc-300">|</span>
      <button onClick={() => set('en')} className="hover:underline">EN</button>
    </div>
  );
}
```
`(panel)/layout.tsx` 상단바에 `<LocaleSwitcher />` 추가. 내비 라벨을 `translate(locale, 'nav.servers')` 등으로 교체(레이아웃은 서버 컴포넌트라 `getLocale()` 사용).

- [ ] **Step 3: 통과 + Commit + Push**

```bash
pnpm vitest run src/lib/i18n/i18n.test.ts && pnpm typecheck
git add src/lib/i18n/ src/components/locale-switcher.tsx src/app/api/locale/ "src/app/(panel)/layout.tsx"
git commit -m "feat(i18n): ko/en dictionary scaffold + locale switcher"
git push
```

> 전체 문자열 번역은 점진 작업(골격·내비·공통만). 신규 문자열은 dictionaries에 키 추가.

---

## Task 4: 권한 인지 서버 탭 내비 [TDD]

**Files:**
- Create: `src/lib/authz/visible-tabs.ts`, `src/lib/authz/visible-tabs.test.ts`
- Modify: `src/registry/server-tabs.ts`, `src/app/(panel)/servers/[id]/layout.tsx`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/authz/visible-tabs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { visibleTabs } from './visible-tabs';
import { serverTabs } from '@/registry/server-tabs';

describe('visibleTabs', () => {
  it('owners/admins see all tabs', () => {
    expect(visibleTabs('owner', []).length).toBe(serverTabs.length);
    expect(visibleTabs('admin', []).length).toBe(serverTabs.length);
  });
  it('subusers see ungated tabs + tabs whose permission they hold', () => {
    const tabs = visibleTabs('subuser', ['file.read']);
    const keys = tabs.map((t) => t.key);
    expect(keys).toContain('overview'); // ungated
    expect(keys).toContain('console');  // ungated
    expect(keys).toContain('files');    // file.read held
    expect(keys).not.toContain('databases'); // database.read NOT held
    expect(keys).not.toContain('subusers');  // user.read NOT held
  });
});
```

- [ ] **Step 2: 구현**

`src/registry/server-tabs.ts`의 `ServerTab`에 optional `permission`을 추가하고, 보수적으로 read 권한이 명확한 탭에만 지정한다(overview/console/settings/activity는 미지정 → 항상 노출):
```ts
export interface ServerTab { key: string; label: string; href: (identifier: string) => string; permission?: string; }
// serverTabs 항목에 permission 추가:
//   files → 'file.read', databases → 'database.read', backups → 'backup.read',
//   network → 'allocation.read', startup → 'startup.read', schedules → 'schedule.read', subusers → 'user.read'
//   overview/console/settings/activity → (permission 없음, 항상 노출)
```

`src/lib/authz/visible-tabs.ts`:
```ts
import { serverTabs, type ServerTab } from '@/registry/server-tabs';

export type AccessKind = 'owner' | 'admin' | 'subuser';

/** Tabs a viewer should see. Owners/admins: all. Subusers: ungated tabs + tabs whose permission they hold. */
export function visibleTabs(accessKind: AccessKind, permissions: string[]): ServerTab[] {
  if (accessKind !== 'subuser') return serverTabs;
  const held = new Set(permissions);
  return serverTabs.filter((t) => !t.permission || held.has(t.permission));
}
```

`src/app/(panel)/servers/[id]/layout.tsx`: `requireServerAccess` 결과에서 `accessKind`/`permissions`를 얻어(이미 Phase 4c에서 서버 객체가 보유) `visibleTabs(accessKind, permissions)`로 렌더 목록을 만든다. (소유/관리자는 전부.)

- [ ] **Step 3: 통과 + Commit + Push**

```bash
pnpm vitest run src/lib/authz/visible-tabs.test.ts src/registry/server-tabs.test.ts && pnpm typecheck
git add src/lib/authz/visible-tabs.ts src/lib/authz/visible-tabs.test.ts src/registry/server-tabs.ts "src/app/(panel)/servers/[id]/layout.tsx"
git commit -m "feat(ui): permission-aware server tab navigation"
git push
```

---

## Task 5: 대시보드 (로그인 후 개요) [TDD]

**Files:**
- Create: `src/server/dashboard.ts`, `src/server/dashboard.test.ts`, `src/features/dashboard/dashboard.tsx`
- Modify: `src/app/(panel)/page.tsx`(없으면 생성; 루트 `/`를 대시보드로)

- [ ] **Step 1: 실패 테스트 작성**

`src/server/dashboard.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '@/test/msw/server';
import { invalidateAccessCache } from '@/lib/authz/access';

vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', role: 'ADMIN', pteroUserId: null, pteroUuid: null, username: 'admin' })) }));

import { getDashboardAction } from './dashboard';

const CLIENT = 'https://panel.test/api/client';
beforeEach(() => invalidateAccessCache());

describe('getDashboardAction', () => {
  it('summarizes accessible servers', async () => {
    mswServer.use(http.get(`${CLIENT}/`, () => HttpResponse.json({ object: 'list', data: [
      { object: 'server', attributes: { identifier: 'aaaaaaaa', uuid: 'aaaaaaaa-0000-4000-8000-000000000000', name: 'A' } },
      { object: 'server', attributes: { identifier: 'bbbbbbbb', uuid: 'bbbbbbbb-0000-4000-8000-000000000000', name: 'B' } },
    ], meta: { pagination: { total: 2, count: 2, per_page: 100, current_page: 1, total_pages: 1 } } })));
    const res = await getDashboardAction();
    expect(res.ok && res.totalServers).toBe(2);
  });
});
```

- [ ] **Step 2: 구현**

`src/server/dashboard.ts`:
```ts
'use server';
import { requireUser } from '@/lib/auth/current-user';
import { resolveAccessibleServers, type ScopeUser } from '@/lib/authz/access';
import type { AccessibleServer } from '@/lib/ptero/types';
import type { User } from '@prisma/client';

function scope(u: User): ScopeUser { return { id: u.id, role: u.role, pteroUserId: u.pteroUserId }; }
type Fail = { ok: false; error: 'failed'; detail?: string };
type Ok = { ok: true; totalServers: number; servers: AccessibleServer[]; isAdmin: boolean; username: string };

export async function getDashboardAction(): Promise<Ok | Fail> {
  try {
    const user = await requireUser();
    const servers = await resolveAccessibleServers(scope(user));
    return { ok: true, totalServers: servers.length, servers: servers.slice(0, 8), isAdmin: user.role === 'ADMIN', username: user.username };
  } catch (err) { console.error('dashboard failed', err); return { ok: false, error: 'failed' }; }
}
```

`src/features/dashboard/dashboard.tsx`:
```tsx
import Link from 'next/link';
import { getDashboardAction } from '@/server/dashboard';
import { Card } from '@/components/ui/card';

export async function Dashboard() {
  const res = await getDashboardAction();
  if (!res.ok) return <p className="text-sm text-red-600">대시보드를 불러오지 못했습니다.</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">안녕하세요, {res.username}님</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><div className="text-3xl font-bold">{res.totalServers}</div><div className="text-xs text-zinc-500">접근 가능 서버</div></Card>
        {res.isAdmin && <Card><div className="text-sm font-medium text-indigo-500">관리자</div><Link href="/admin" className="text-xs hover:underline">관리자 영역 →</Link></Card>}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium">최근 서버</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {res.servers.map((s) => (
            <Link key={s.identifier} href={`/servers/${s.identifier}`}><Card className="hover:border-indigo-400"><div className="font-medium">{s.name}</div><div className="text-xs text-zinc-500">{s.node ?? s.identifier}</div></Card></Link>
          ))}
        </div>
      </div>
    </div>
  );
}
```

`src/app/(panel)/page.tsx`:
```tsx
import { Dashboard } from '@/features/dashboard/dashboard';
export default function Home() { return <Dashboard />; }
```
> 미들웨어/로그인 리다이렉트 타깃이 `/servers`였다면 `/`(대시보드)로 바꿀지는 선택. 이번엔 `/`를 대시보드로 두고 `/servers`는 그대로 목록.

- [ ] **Step 3: 통과 + Commit + Push**

```bash
pnpm vitest run src/server/dashboard.test.ts && pnpm typecheck
git add src/server/dashboard.ts src/server/dashboard.test.ts src/features/dashboard/ "src/app/(panel)/page.tsx"
git commit -m "feat(ui): post-login dashboard overview"
git push
```

---

## Task 6: 글로벌 에러/404 바운더리 + 429 UX

**Files:**
- Create: `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/(panel)/error.tsx`

- [ ] **Step 1: 에러/404 컴포넌트 작성**

`src/app/not-found.tsx`:
```tsx
import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="text-sm text-zinc-500">요청한 페이지나 서버를 찾을 수 없습니다.</p>
      <Link href="/" className="text-sm text-indigo-600 hover:underline">홈으로</Link>
    </main>
  );
}
```

`src/app/error.tsx` (전역) 및 `src/app/(panel)/error.tsx` (패널 영역):
```tsx
'use client';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">문제가 발생했습니다</h1>
      <p className="text-sm text-zinc-500">일시적인 오류일 수 있습니다. 다시 시도해 주세요.{error.digest ? ` (${error.digest})` : ''}</p>
      <button onClick={reset} className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white">다시 시도</button>
    </main>
  );
}
```
> `src/app/error.tsx`는 `'use client'` 필수(루트 레이아웃을 못 감싸므로 `global-error.tsx`도 선택적으로 추가 가능). 패널 영역 에러는 `(panel)/error.tsx`가 처리.

- [ ] **Step 2: 429 UX 강화(에러 메시지 매핑)**

`src/lib/ptero/http.ts`의 429 처리는 이미 백오프 후 재시도. 재시도 소진 시 던져지는 `PteroApiError(429)`를 액션 레이어가 사용자 메시지로 노출하도록, 액션 공통 `toFail`에서 `httpStatus===429`면 detail을 "요청이 많습니다. 잠시 후 다시 시도해 주세요."로 매핑(각 `toFail` 또는 공통 헬퍼). 최소: `src/lib/ptero/errors.ts`에 `friendlyMessage(err: PteroApiError): string` 헬퍼를 추가하고 UI에서 활용.
```ts
// errors.ts
export function friendlyMessage(err: PteroApiError): string {
  switch (err.httpStatus) {
    case 429: return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    case 409: return err.primary?.detail ?? '현재 상태에서는 처리할 수 없습니다.';
    case 413: return '파일이 너무 큽니다.';
    default: return err.primary?.detail ?? '오류가 발생했습니다.';
  }
}
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add "src/app/error.tsx" "src/app/not-found.tsx" "src/app/(panel)/error.tsx" src/lib/ptero/errors.ts
git commit -m "feat(ux): global error/404 boundaries + friendly error messages"
git push
```

---

## Task 7: 보안 헤더 · 헬스체크 · 프로덕션 하드닝

**Files:**
- Modify: `next.config.mjs`, `README.md`
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: 보안 헤더**

`next.config.mjs`에 `headers()` 추가:
```js
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
      ],
    }];
  },
};
```
> CSP는 콘솔 WS(Wings origin)·xterm 인라인 스타일 때문에 신중히 — 우선 위 헤더만, CSP는 별도 검증 후. README에 메모.

- [ ] **Step 2: 헬스체크 엔드포인트**

`src/app/api/health/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
export async function GET() {
  try { await prisma.$queryRaw`SELECT 1`; return NextResponse.json({ status: 'ok' }); }
  catch { return NextResponse.json({ status: 'degraded' }, { status: 503 }); }
}
```
`docker-compose.yml`의 `app` 서비스에 healthcheck 추가(`wget`/`curl`로 `/api/health`).

- [ ] **Step 3: README 운영·보안 섹션**

`README.md`에 추가: 보안 헤더, 헬스체크(`/api/health`), 프로덕션 체크리스트(두 키 IP allowlist·HTTPS·Wings `allowed_origins`·`SESSION_SECRET` 강도·정기 `서브유저 스코프 동기화`).

- [ ] **Step 4: 타입체크·빌드 + Commit + Push**

```bash
pnpm typecheck && pnpm build
git add next.config.mjs src/app/api/health/ docker-compose.yml README.md
git commit -m "feat(ops): security headers, health endpoint, prod hardening docs"
git push
```

---

## Task 8: e2e + 최종 검증

**Files:**
- Create: `e2e/polish.spec.ts`

- [ ] **Step 1: e2e 스펙**

`e2e/polish.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
async function login(page, id: string, pw: string) { await page.goto('/login'); await page.fill('input[name="identifier"]', id); await page.fill('input[name="password"]', pw); await page.click('button[type="submit"]'); await page.waitForURL(/\/(servers)?$/); }

test('dashboard shows server count', async ({ page }) => { await login(page, 'admin', 'admin-pass'); await page.goto('/'); await expect(page.getByText('접근 가능 서버')).toBeVisible(); });
test('theme toggle persists', async ({ page }) => { await login(page, 'admin', 'admin-pass'); await page.goto('/'); await page.getByLabel('테마 전환').click(); await expect(page.locator('html')).toHaveClass(/dark/); });
test('health endpoint responds', async ({ request }) => { const res = await request.get('/api/health'); expect([200, 503]).toContain(res.status()); });
test('unknown route renders 404', async ({ page }) => { const res = await page.goto('/no-such-page'); expect(res?.status()).toBe(404); });
```

- [ ] **Step 2: 전체 검증**

Run:
```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린.

- [ ] **Step 3: Commit + Push**

```bash
git add e2e/
git commit -m "test(e2e): dashboard, theme, health, 404"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§11/§12/§14/§15):** 토스트 ✓T1 · 테마 ✓T2 · i18n 골격 ✓T3 · 권한 인지 내비(이연 항목) ✓T4 · 대시보드 ✓T5 · 에러/404 바운더리·친화 메시지·429 UX ✓T6 · 보안 헤더·헬스체크·프로덕션 문서 ✓T7.
- **보안:** 테마/언어는 쿠키(서버 적용, 플래시 없음). 권한 인지 내비는 **보수적**(권한 미지정 탭 항상 노출, 소유/관리자 전부) — 유효 탭을 잘못 숨기지 않음. 대시보드는 `resolveAccessibleServers`로 스코프 유지. 보안 헤더 추가. 헬스체크는 비밀 노출 없음.
- **플레이스홀더 스캔:** 모든 코드/명령 실측. i18n 전체 번역은 골격만(명시).
- **타입 일관성:** `visibleTabs(accessKind, permissions)` 순수 함수(테스트됨). `ServerTab.permission` optional 추가가 기존 렌더와 호환. 대시보드 `Ok/Fail` 패턴. `friendlyMessage`는 기존 `PteroApiError` 활용.
- **테스트:** i18n·visible-tabs·dashboard 단위 + polish e2e. UI(토스트/테마/에러 컴포넌트)는 e2e/수동.

---

## Phase 5 완료 후
마지막 **Phase 6**(플러그인 시스템)만 남는다 — §17의 매니페스트·SDK·확장지점·라이프사이클·**샌드박싱/보안**·레지스트리. 자체 spec(브레인스토밍)부터 시작 권장(아키텍처 결정 다수). 이후 프로젝트 로드맵 완성.
