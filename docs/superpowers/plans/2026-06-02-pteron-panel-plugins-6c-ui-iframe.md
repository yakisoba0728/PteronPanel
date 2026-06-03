# Pteron Panel — Plugins 6c: UI iframe Extension 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 플러그인 UI를 **샌드박스 iframe** 서버 뷰 탭으로 노출하고, iframe이 **단기 컨텍스트 토큰**으로 `/api/ext/*`를 소유자 스코프로 호출하게 한다(장기 `ptex_`는 iframe에 노출 안 함).

**Architecture:** 소유자의 `uiTabUrl` 플러그인이 그가 접근 가능한 서버의 뷰에 탭으로 추가됨. 탭 페이지는 `<iframe sandbox>`(동일 출처 미허용)로 플러그인 UI를 임베드하고, 부모가 `postMessage`로 **단기 컨텍스트 토큰(`ptxc_`, HMAC 서명·exp)** 을 전달 → iframe이 `/api/ext`를 호출. `authenticatePlugin`이 `ptex_`(장기)·`ptxc_`(단기) 둘 다 수용.

**Tech Stack:** Next 15 App Router · Node `crypto`(HMAC) · postMessage · Vitest. **선행:** 6a 완료(`Plugin`·`authenticatePlugin`·`/api/ext`·tab registry seam). 참조 spec §8,9.

> **표준 규칙:** 각 Task commit + push. **AI 워터마크 금지.** **워크트리**에서 작업.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/plugins/context-token.ts` | 단기 컨텍스트 토큰 생성/검증(HMAC+exp, stateless) |
| `src/lib/plugins/auth.ts`(수정) | `ptex_` + `ptxc_` 둘 다 인증 |
| `src/server/plugins.ts`(수정) | `getPluginContextAction`(소유자 단기 토큰 발급) |
| `src/lib/plugins/owner-tabs.ts` | 소유자 플러그인 → 서버 뷰 탭 목록 |
| `src/app/(panel)/servers/[id]/plugin/[pluginId]/page.tsx` | iframe 탭 페이지 |
| `src/features/plugins/plugin-frame.tsx` | iframe + postMessage 브리지 |
| `src/app/(panel)/servers/[id]/layout.tsx`(수정) | 소유자 플러그인 탭 병합 렌더 |
| `e2e/plugin-iframe.spec.ts` | e2e |

---

## Task 1: 단기 컨텍스트 토큰 [TDD]

**Files:** Create `src/lib/plugins/context-token.ts`, `src/lib/plugins/context-token.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/plugins/context-token.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateContextToken, verifyContextToken } from './context-token';

afterEach(() => vi.useRealTimers());

describe('context token', () => {
  it('round-trips pluginId + ownerId', () => {
    const t = generateContextToken('pl1', 'u1', 5 * 60 * 1000);
    expect(t).toMatch(/^ptxc_/);
    expect(verifyContextToken(t)).toEqual({ pluginId: 'pl1', ownerId: 'u1' });
  });
  it('rejects a tampered token', () => {
    const t = generateContextToken('pl1', 'u1', 60_000);
    expect(verifyContextToken(t.slice(0, -3) + 'zzz')).toBeNull();
  });
  it('rejects an expired token', () => {
    vi.useFakeTimers();
    const t = generateContextToken('pl1', 'u1', 1000);
    vi.advanceTimersByTime(2000);
    expect(verifyContextToken(t)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/plugins/context-token.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '@/lib/config';

function sign(payloadB64: string): string {
  return createHmac('sha256', getConfig().SESSION_SECRET).update(`ctx.${payloadB64}`).digest('base64url');
}

/** Stateless short-lived token for iframe → /api/ext. Format: ptxc_<payloadB64>.<sig> */
export function generateContextToken(pluginId: string, ownerId: string, ttlMs: number): string {
  const payload = { pluginId, ownerId, exp: Date.now() + ttlMs };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `ptxc_${b64}.${sign(b64)}`;
}

export function verifyContextToken(token: string): { pluginId: string; ownerId: string } | null {
  if (!token.startsWith('ptxc_')) return null;
  const [b64, sig] = token.slice(5).split('.');
  if (!b64 || !sig) return null;
  const expected = sign(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as { pluginId: string; ownerId: string; exp: number };
    if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return { pluginId: p.pluginId, ownerId: p.ownerId };
  } catch { return null; }
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/context-token.test.ts
git add src/lib/plugins/context-token.ts src/lib/plugins/context-token.test.ts
git commit -m "feat(plugins): short-lived iframe context token (HMAC + exp)"
git push
```

---

## Task 2: `authenticatePlugin`이 컨텍스트 토큰 수용 [TDD]

**Files:** Modify `src/lib/plugins/auth.ts`; Create `src/lib/plugins/auth.context.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/plugins/auth.context.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const prismaMock = { plugin: { findUnique: vi.fn(), findFirst: vi.fn() }, user: { findUnique: vi.fn() } };
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
import { authenticatePlugin } from './auth';
import { generateContextToken } from './context-token';

beforeEach(() => vi.clearAllMocks());
const req = (auth: string) => new Request('https://x/api/ext/servers', { headers: { authorization: auth } });

describe('authenticatePlugin with context token', () => {
  it('accepts a valid ptxc_ token for an enabled plugin', async () => {
    const t = generateContextToken('pl1', 'u1', 60_000);
    prismaMock.plugin.findUnique.mockResolvedValue({ id: 'pl1', ownerId: 'u1', enabled: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', role: 'USER', pteroUserId: 7, isActive: true });
    const ctx = await authenticatePlugin(req(`Bearer ${t}`));
    expect(ctx?.owner.id).toBe('u1');
    expect(ctx?.pluginId).toBe('pl1');
  });
  it('rejects ptxc_ whose pluginId/ownerId mismatch DB', async () => {
    const t = generateContextToken('pl1', 'uX', 60_000); // owner mismatch
    prismaMock.plugin.findUnique.mockResolvedValue({ id: 'pl1', ownerId: 'u1', enabled: true });
    expect(await authenticatePlugin(req(`Bearer ${t}`))).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인 → `auth.ts` 수정**

`authenticatePlugin`에 `ptxc_` 분기 추가(상단 `import { verifyContextToken } from './context-token';`):
```ts
export async function authenticatePlugin(req: Request): Promise<PluginContext | null> {
  const header = req.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;

  let pluginId: string | null = null;
  if (token.startsWith('ptxc_')) {
    const ctx = verifyContextToken(token);
    if (!ctx) return null;
    const plugin = await prisma.plugin.findUnique({ where: { id: ctx.pluginId } });
    if (!plugin || !plugin.enabled || plugin.ownerId !== ctx.ownerId) return null;
    pluginId = plugin.id;
  } else if (token.startsWith('ptex_')) {
    const plugin = await prisma.plugin.findUnique({ where: { tokenHash: hashPluginToken(token) } });
    if (!plugin || !plugin.enabled) return null;
    pluginId = plugin.id;
  } else {
    return null;
  }

  const plugin = await prisma.plugin.findUnique({ where: { id: pluginId } });
  if (!plugin) return null;
  const owner = await prisma.user.findUnique({ where: { id: plugin.ownerId }, select: { id: true, role: true, pteroUserId: true, isActive: true } });
  if (!owner || !owner.isActive) return null;
  return { pluginId: plugin.id, owner: { id: owner.id, role: owner.role, pteroUserId: owner.pteroUserId } };
}
```
(6a 기존 테스트가 `findUnique`를 쓰므로 호환. `isActive` select 포함하도록 정리.)

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/auth.test.ts src/lib/plugins/auth.context.test.ts
git add src/lib/plugins/auth.ts src/lib/plugins/auth.context.test.ts
git commit -m "feat(plugins): accept short-lived context token in /api/ext auth"
git push
```

---

## Task 3: 컨텍스트 토큰 발급 액션 [TDD]

**Files:** Modify `src/server/plugins.ts`; Create `src/server/plugins.context.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/server/plugins.context.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const prismaMock = { plugin: { findFirst: vi.fn() } };
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
let currentUser: any = { id: 'u1', role: 'USER', pteroUserId: 7 };
vi.mock('@/lib/auth/current-user', () => ({ requireUser: vi.fn(async () => currentUser) }));
import { getPluginContextAction } from './plugins';
import { verifyContextToken } from '@/lib/plugins/context-token';

beforeEach(() => { currentUser = { id: 'u1', role: 'USER', pteroUserId: 7 }; vi.clearAllMocks(); });

describe('getPluginContextAction', () => {
  it('issues a context token for an owned plugin', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ id: 'pl1', ownerId: 'u1', uiTabUrl: 'https://ui' });
    const r = await getPluginContextAction('pl1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(verifyContextToken(r.token)).toEqual({ pluginId: 'pl1', ownerId: 'u1' });
  });
  it('refuses a plugin not owned by the caller', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue(null);
    expect(await getPluginContextAction('plX')).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 (plugins.ts에 추가)**

```ts
import { generateContextToken } from '@/lib/plugins/context-token';

export async function getPluginContextAction(pluginId: string): Promise<Ok<{ token: string }> | Fail> {
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({ where: { id: pluginId, ownerId: user.id } });
  if (!plugin) return { ok: false, error: 'not_found' };
  return { ok: true, token: generateContextToken(plugin.id, user.id, 5 * 60 * 1000) };
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/server/plugins.context.test.ts
git add src/server/plugins.ts src/server/plugins.context.test.ts
git commit -m "feat(plugins): issue short-lived iframe context token (owner-checked)"
git push
```

---

## Task 4: 소유자 플러그인 탭 목록 [TDD]

**Files:** Create `src/lib/plugins/owner-tabs.ts`, `src/lib/plugins/owner-tabs.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/lib/plugins/owner-tabs.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
const prismaMock = { plugin: { findMany: vi.fn() } };
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
import { ownerPluginTabs } from './owner-tabs';

beforeEach(() => vi.clearAllMocks());

describe('ownerPluginTabs', () => {
  it('returns enabled plugins with a uiTabUrl as tab descriptors', async () => {
    prismaMock.plugin.findMany.mockResolvedValue([
      { id: 'pl1', uiTabLabel: 'My Tab', uiTabUrl: 'https://ui', enabled: true },
      { id: 'pl2', uiTabLabel: null, uiTabUrl: null, enabled: true },
    ]);
    const tabs = await ownerPluginTabs('u1', '1a2b3c4d');
    expect(prismaMock.plugin.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerId: 'u1', enabled: true, uiTabUrl: { not: null } } }));
    expect(tabs).toEqual([{ key: 'plugin:pl1', label: 'My Tab', href: '/servers/1a2b3c4d/plugin/pl1' }]);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/plugins/owner-tabs.ts`:
```ts
import { prisma } from '@/lib/db';

export interface PluginTab { key: string; label: string; href: string; }

/** Tabs for the viewer's own uiTabUrl plugins, scoped to a server view. */
export async function ownerPluginTabs(ownerId: string, identifier: string): Promise<PluginTab[]> {
  const plugins = await prisma.plugin.findMany({ where: { ownerId, enabled: true, uiTabUrl: { not: null } }, orderBy: { createdAt: 'asc' } });
  return plugins.map((p) => ({ key: `plugin:${p.id}`, label: p.uiTabLabel ?? p.name, href: `/servers/${identifier}/plugin/${p.id}` }));
}
```

- [ ] **Step 3: 통과 + Commit**

```bash
pnpm vitest run src/lib/plugins/owner-tabs.test.ts
git add src/lib/plugins/owner-tabs.ts src/lib/plugins/owner-tabs.test.ts
git commit -m "feat(plugins): owner plugin tab descriptors for server view"
git push
```

---

## Task 5: iframe 탭 페이지 + 브리지 + 레이아웃 병합

**Files:** Create `src/features/plugins/plugin-frame.tsx`, `src/app/(panel)/servers/[id]/plugin/[pluginId]/page.tsx`; Modify `src/app/(panel)/servers/[id]/layout.tsx`

- [ ] **Step 1: iframe 브리지(Client)**

`src/features/plugins/plugin-frame.tsx`:
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { getPluginContextAction } from '@/server/plugins';

export function PluginFrame({ pluginId, src }: { pluginId: string; src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const origin = (() => { try { return new URL(src).origin; } catch { return null; } })();

  useEffect(() => {
    if (!origin) { setError('잘못된 플러그인 URL'); return; }
    let cancelled = false;
    async function onLoad() {
      const r = await getPluginContextAction(pluginId);
      if (cancelled) return;
      if (!r.ok) { setError('컨텍스트 토큰 발급 실패'); return; }
      // hand the short-lived token to the iframe; it calls /api/ext with it
      ref.current?.contentWindow?.postMessage({ type: 'pteron:context', token: r.token, apiBase: location.origin }, origin!);
    }
    const iframe = ref.current;
    iframe?.addEventListener('load', onLoad);
    return () => { cancelled = true; iframe?.removeEventListener('load', onLoad); };
  }, [pluginId, origin]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  return (
    <iframe
      ref={ref}
      src={src}
      sandbox="allow-scripts allow-forms allow-popups"
      className="h-[70vh] w-full rounded-md border border-zinc-200 dark:border-zinc-800"
      title="plugin"
    />
  );
}
```
> `sandbox`에 `allow-same-origin` 미포함 → iframe은 고유(opaque) origin으로 격리. 토큰은 URL이 아니라 `postMessage(targetOrigin=플러그인 origin)`로만 전달.

- [ ] **Step 2: 탭 페이지(소유권 확인)**

`src/app/(panel)/servers/[id]/plugin/[pluginId]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { PluginFrame } from '@/features/plugins/plugin-frame';

export default async function PluginTabPage({ params }: { params: Promise<{ id: string; pluginId: string }> }) {
  const { pluginId } = await params;
  const user = await requireUser();
  const plugin = await prisma.plugin.findFirst({ where: { id: pluginId, ownerId: user.id, enabled: true } });
  if (!plugin || !plugin.uiTabUrl) notFound();
  return (
    <div className="space-y-2">
      <h2 className="font-medium">{plugin.uiTabLabel ?? plugin.name}</h2>
      <PluginFrame pluginId={plugin.id} src={plugin.uiTabUrl} />
    </div>
  );
}
```
> 서버 접근 가드는 부모 `[id]/layout.tsx`의 `requireServerAccess`가 이미 강제. 여기선 추가로 플러그인 소유·활성 확인.

- [ ] **Step 3: 레이아웃에 플러그인 탭 병합**

`src/app/(panel)/servers/[id]/layout.tsx` 수정: 기존 `visibleTabs(...)` 결과 뒤에 `ownerPluginTabs(user.id, id)`를 이어붙여 렌더(플러그인 탭은 라벨+href만; 권한 게이팅 대상 아님 — 소유자 본인 플러그인). 상단 `import { ownerPluginTabs } from '@/lib/plugins/owner-tabs';`.

- [ ] **Step 4: 타입체크 + Commit**

```bash
pnpm typecheck
git add src/features/plugins/plugin-frame.tsx "src/app/(panel)/servers/[id]/plugin" "src/app/(panel)/servers/[id]/layout.tsx"
git commit -m "feat(plugins): sandboxed iframe plugin tabs + postMessage context token"
git push
```

---

## Task 6: e2e + 최종 검증

**Files:** Create `e2e/plugin-iframe.spec.ts`; Modify `README.md`

- [ ] **Step 1: e2e — 플러그인 탭 렌더**

`e2e/plugin-iframe.spec.ts`: 시드 또는 등록으로 `uiTabUrl` 플러그인을 만든 USER가 자기 서버 뷰에서 플러그인 탭을 보고, 클릭 시 `iframe[title="plugin"]`이 렌더됨을 확인. (iframe src는 e2e mock UI origin; postMessage 토큰 검증은 단위로 커버.)

- [ ] **Step 2: README 작성 가이드**

`README.md` 플러그인 가이드에 추가: iframe UI는 `message` 이벤트로 `{type:'pteron:context', token, apiBase}`를 받아 `Authorization: Bearer <token>`으로 `${apiBase}/api/ext/*` 호출. iframe은 sandbox(고유 origin)임을 명시. CSP `frame-src`는 후속 하드닝(플러그인 origin 동적 허용).

- [ ] **Step 3: 전체 검증 + Commit**

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate deploy
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
git add e2e/ README.md
git commit -m "test(e2e): plugin iframe tab render + README UI guide"
git push
```

---

## Self-Review (작성자 체크리스트)

- **Spec 커버리지(§8,9):** 단기 컨텍스트 토큰 ✓T1 · `/api/ext` 토큰 수용 ✓T2 · 발급 액션(소유자 확인) ✓T3 · 소유자 플러그인 탭 ✓T4 · iframe 샌드박스+브리지+레이아웃 ✓T5.
- **보안:** iframe `sandbox`(allow-same-origin 없음 → opaque origin). 컨텍스트 토큰 5분 만료·HMAC·plugin/owner DB 재확인·비활성 거부. 토큰은 URL 아닌 postMessage(targetOrigin) 전달. 탭 페이지 소유권 확인. 부모 서버 접근 가드 유지.
- **플레이스홀더 스캔:** 코드/명령 실측. CSP frame-src 동적 허용은 후속 하드닝으로 명시.
- **타입 일관성:** `PluginContext`(6a) 재사용·확장. `verifyContextToken`/`generateContextToken` 시그니처 일관. `ownerPluginTabs` 반환형 명확. `Ok/Fail`(6a) 동일. layout 병합이 `visibleTabs`(Phase 5)와 공존.

---

## Phase 6 완료
6a(등록·토큰·스코프 API) + 6b(이벤트 webhook) + 6c(UI iframe)로 **외부 통합 플러그인 시스템** 완성. 이로써 로드맵 Phase 0–6이 전부 설계·계획 완료된다. (잔여 하드닝: webhook SSRF 사설IP 차단, webhook 전용 큐 — 후속 보안 태스크. CSP frame-src 동적 허용은 2026-06-03 구현됨 → `docs/superpowers/specs/2026-06-03-pteron-panel-csp-frame-src-design.md`.)
