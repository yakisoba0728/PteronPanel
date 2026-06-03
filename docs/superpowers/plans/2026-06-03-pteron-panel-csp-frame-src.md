# CSP `frame-src` 동적 허용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 패널 전역에 frame-only CSP를 적용하되, 플러그인 탭 라우트에서만 해당 플러그인의 등록된 origin을 `frame-src`로 동적 허용한다.

**Architecture:** CSP는 기존 Node 보안 초크포인트 `server.ts`가 단독 소유한다. Next `handle()`로 위임하기 전에 요청 pathname을 보고 `Content-Security-Policy` 헤더를 set 한다. 순수 헬퍼(`src/lib/security/csp.ts`)가 정책 문자열·경로 매칭을 담당하고, DB 조회(`src/lib/plugins/frame-origin.ts`)가 pluginId → origin을 해석한다. frame 지시자만 설정하므로 콘솔 WS·xterm·signed-URL 업로드 등 다른 흐름은 영향받지 않는다.

**Tech Stack:** Next.js 15.1(App Router) 커스텀 서버(`server.ts`), Prisma, Vitest(단위, prisma 목), Playwright(e2e, `server.ts` 경유 실행).

**Spec:** `docs/superpowers/specs/2026-06-03-pteron-panel-csp-frame-src-design.md`

---

## File Structure

- `src/lib/security/csp.ts` (신규) — 순수 함수: `shouldSetCsp`, `pluginIdFromPath`, `buildFrameCsp`, 상수 `FRAME_CSP_BASELINE`. DB·IO 없음.
- `src/lib/security/csp.test.ts` (신규) — 위 순수 함수 단위 테스트.
- `src/lib/plugins/frame-origin.ts` (신규) — `getEnabledPluginUiOrigin(pluginId)`: Prisma로 enabled 플러그인 `uiTabUrl`의 origin 해석, 실패 시 null.
- `src/lib/plugins/frame-origin.test.ts` (신규) — prisma 목 단위 테스트.
- `server.ts` (수정) — 헬퍼를 사용해 `handle()` 전에 CSP 헤더 주입.
- `e2e/plugin-iframe.spec.ts` (수정) — 플러그인 탭 응답의 동적 `frame-src` 및 일반 페이지의 `frame-src 'none'` 단언.
- `README.md` (수정) — 후속 작업 문구를 구현됨으로 갱신.
- `docs/superpowers/plans/2026-06-02-pteron-panel-plugins-6c-ui-iframe.md` (수정) — 잔여 하드닝 목록에서 본 항목 구현됨 표기.

---

## Task 1: 순수 CSP 헬퍼

**Files:**
- Create: `src/lib/security/csp.ts`
- Test: `src/lib/security/csp.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/security/csp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FRAME_CSP_BASELINE,
  buildFrameCsp,
  pluginIdFromPath,
  shouldSetCsp,
} from './csp';

describe('pluginIdFromPath', () => {
  it('extracts the pluginId from a plugin tab route', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d/plugin/pl1')).toBe('pl1');
  });
  it('allows a trailing slash', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d/plugin/pl1/')).toBe('pl1');
  });
  it('returns null for non-plugin routes', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d')).toBeNull();
    expect(pluginIdFromPath('/login')).toBeNull();
  });
  it('returns null when there is an extra path segment', () => {
    expect(pluginIdFromPath('/servers/1a2b3c4d/plugin/pl1/extra')).toBeNull();
  });
});

describe('buildFrameCsp', () => {
  it('denies all framing without an origin', () => {
    expect(buildFrameCsp(null)).toBe("frame-src 'none'; frame-ancestors 'none'");
    expect(buildFrameCsp(null)).toBe(FRAME_CSP_BASELINE);
  });
  it('allows the given plugin origin', () => {
    expect(buildFrameCsp('https://x.example')).toBe(
      "frame-src 'self' https://x.example; frame-ancestors 'none'",
    );
  });
});

describe('shouldSetCsp', () => {
  it('skips assets and APIs', () => {
    expect(shouldSetCsp('/_next/static/x.js')).toBe(false);
    expect(shouldSetCsp('/api/ext/servers')).toBe(false);
    expect(shouldSetCsp('/favicon.ico')).toBe(false);
  });
  it('applies to document routes', () => {
    expect(shouldSetCsp('/servers/1a2b3c4d')).toBe(true);
    expect(shouldSetCsp('/servers/1a2b3c4d/plugin/pl1')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/security/csp.test.ts`
Expected: FAIL — `Failed to resolve import './csp'` (모듈 없음).

- [ ] **Step 3: 구현**

Create `src/lib/security/csp.ts`:

```ts
/**
 * Frame-only Content-Security-Policy.
 *
 * We intentionally set ONLY frame directives so the rest of the app (console
 * WebSocket, xterm inline styles, signed-URL uploads to Wings nodes) is
 * unaffected. A fuller CSP lockdown is tracked as separate follow-up work.
 */

export const FRAME_CSP_BASELINE = "frame-src 'none'; frame-ancestors 'none'";

const PLUGIN_PATH = /^\/servers\/[^/]+\/plugin\/([^/]+)\/?$/;

/** Pathnames that should NOT receive a CSP header (static assets, APIs). */
export function shouldSetCsp(pathname: string): boolean {
  return !(
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico'
  );
}

/** The pluginId of a plugin tab route, or null when the path is not one. */
export function pluginIdFromPath(pathname: string): string | null {
  return PLUGIN_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * Build the frame-only CSP. With a resolved plugin origin, allow framing it
 * (plus self); otherwise deny all framing.
 */
export function buildFrameCsp(pluginOrigin: string | null): string {
  if (!pluginOrigin) return FRAME_CSP_BASELINE;
  return `frame-src 'self' ${pluginOrigin}; frame-ancestors 'none'`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/security/csp.test.ts`
Expected: PASS (모든 케이스).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/security/csp.ts src/lib/security/csp.test.ts
git commit -m "feat(csp): pure frame-only CSP helpers"
```

---

## Task 2: 플러그인 origin 조회

**Files:**
- Create: `src/lib/plugins/frame-origin.ts`
- Test: `src/lib/plugins/frame-origin.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/plugins/frame-origin.test.ts` (prisma 목 패턴은 `src/lib/plugins/owner-tabs.test.ts`와 동일):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { plugin: { findFirst: vi.fn() } },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { getEnabledPluginUiOrigin } from './frame-origin';

beforeEach(() => vi.clearAllMocks());

describe('getEnabledPluginUiOrigin', () => {
  it('returns the origin of an enabled plugin uiTabUrl', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'https://x.example/ui' });

    expect(await getEnabledPluginUiOrigin('pl1')).toBe('https://x.example');
    expect(prismaMock.plugin.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pl1', enabled: true, uiTabUrl: { not: null } },
      }),
    );
  });

  it('returns null when no plugin matches', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue(null);
    expect(await getEnabledPluginUiOrigin('missing')).toBeNull();
  });

  it('returns null when the stored URL cannot be parsed', async () => {
    prismaMock.plugin.findFirst.mockResolvedValue({ uiTabUrl: 'not a url' });
    expect(await getEnabledPluginUiOrigin('pl1')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run src/lib/plugins/frame-origin.test.ts`
Expected: FAIL — `Failed to resolve import './frame-origin'`.

- [ ] **Step 3: 구현**

Create `src/lib/plugins/frame-origin.ts`:

```ts
import { prisma } from '@/lib/db';

/**
 * Resolve the origin of an enabled plugin's uiTabUrl, for CSP frame-src.
 *
 * Returns null when the plugin is missing, disabled, has no uiTabUrl, or the
 * stored URL cannot be parsed. Looked up by id only — the plugin tab page
 * enforces ownership (404 for non-owners) and the origin is not secret.
 */
export async function getEnabledPluginUiOrigin(pluginId: string): Promise<string | null> {
  const plugin = await prisma.plugin.findFirst({
    where: { id: pluginId, enabled: true, uiTabUrl: { not: null } },
    select: { uiTabUrl: true },
  });
  if (!plugin?.uiTabUrl) return null;
  try {
    return new URL(plugin.uiTabUrl).origin;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run src/lib/plugins/frame-origin.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/plugins/frame-origin.ts src/lib/plugins/frame-origin.test.ts
git commit -m "feat(csp): resolve enabled plugin ui origin for frame-src"
```

---

## Task 3: `server.ts`에 동적 CSP 주입

**Files:**
- Modify: `server.ts`

server.ts는 커스텀 서버 엔트리포인트라 단위 테스트 대상이 아니다(콘솔 프록시와 동일하게 e2e로 검증). 이 태스크는 typecheck/build로 컴파일을 확인하고, 동작은 Task 4의 e2e가 검증한다.

- [ ] **Step 1: import 추가**

`server.ts` 상단 import 블록을 수정한다. 기존:

```ts
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import WebSocket, { WebSocketServer } from 'ws';
import { getConfig } from '@/lib/config';
import { validateSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { bridgeConsole } from '@/lib/console/proxy';
```

다음으로 교체:

```ts
import { createServer, type ServerResponse } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import WebSocket, { WebSocketServer } from 'ws';
import { getConfig } from '@/lib/config';
import { validateSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { bridgeConsole } from '@/lib/console/proxy';
import {
  FRAME_CSP_BASELINE,
  buildFrameCsp,
  pluginIdFromPath,
  shouldSetCsp,
} from '@/lib/security/csp';
import { getEnabledPluginUiOrigin } from '@/lib/plugins/frame-origin';
```

- [ ] **Step 2: CSP 주입 함수 추가**

`server.ts`에서 `app.prepare().then(() => {` 바로 위(즉 `isAllowedWsOrigin` 함수 정의 다음)에 추가:

```ts
// Frame-only CSP. Deny framing everywhere except the plugin tab route, which
// may frame its own registered plugin origin. Set before delegating to Next so
// the header rides the document response. Fail-closed to baseline on any error.
async function applyCspHeader(res: ServerResponse, pathname: string): Promise<void> {
  try {
    if (!shouldSetCsp(pathname)) return;
    const pluginId = pluginIdFromPath(pathname);
    const origin = pluginId ? await getEnabledPluginUiOrigin(pluginId) : null;
    res.setHeader('Content-Security-Policy', buildFrameCsp(origin));
  } catch {
    res.setHeader('Content-Security-Policy', FRAME_CSP_BASELINE);
  }
}
```

- [ ] **Step 3: `createServer` 콜백 배선**

기존 라인:

```ts
  const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));
```

다음으로 교체:

```ts
  const server = createServer(async (req, res) => {
    const parsed = parse(req.url!, true);
    await applyCspHeader(res, parsed.pathname ?? '/');
    handle(req, res, parsed);
  });
```

`applyCspHeader`는 내부 try/catch로 절대 reject하지 않으므로 `handle()`은 항상 호출된다. WS upgrade 핸들러는 변경하지 않는다.

- [ ] **Step 4: typecheck + lint + build 확인**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: 모두 통과(에러·경고 0). (typecheck가 `.next/types` 옛 아티팩트로 실패하면 `rm -rf .next && pnpm build` 후 재시도.)

- [ ] **Step 5: 커밋**

```bash
git add server.ts
git commit -m "feat(csp): inject dynamic frame-src CSP in server.ts"
```

---

## Task 4: e2e — 동적 `frame-src` 단언

**Files:**
- Modify: `e2e/plugin-iframe.spec.ts`

기존 테스트('user sees a registered plugin iframe tab on a server view')의 `try` 블록 끝, iframe `src` 단언 직후에 CSP 단언을 추가한다.

- [ ] **Step 1: 단언 추가**

`e2e/plugin-iframe.spec.ts`에서 다음 라인:

```ts
    await expect(page.locator('iframe[title="plugin"]')).toHaveAttribute('src', pluginUi.url);
  } finally {
```

을 다음으로 교체:

```ts
    await expect(page.locator('iframe[title="plugin"]')).toHaveAttribute('src', pluginUi.url);

    // CSP frame-src is dynamically scoped to this plugin's origin.
    const pluginOrigin = new URL(pluginUi.url).origin;
    const pluginPath = new URL(page.url()).pathname;
    const pluginResponse = await page.goto(pluginPath);
    const pluginCsp = pluginResponse?.headers()['content-security-policy'] ?? '';
    expect(pluginCsp).toContain(`frame-src 'self' ${pluginOrigin}`);
    expect(pluginCsp).toContain("frame-ancestors 'none'");
    await expect(page.locator('iframe[title="plugin"]')).toBeVisible();

    // A non-plugin page denies framing entirely.
    const baseResponse = await page.goto('/servers/1a2b3c4d');
    const baseCsp = baseResponse?.headers()['content-security-policy'] ?? '';
    expect(baseCsp).toContain("frame-src 'none'");
    expect(baseCsp).toContain("frame-ancestors 'none'");
  } finally {
```

- [ ] **Step 2: e2e 실행 (DB 필요)**

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate deploy
pnpm e2e
```

Expected: `plugin-iframe.spec.ts`의 단언 통과, `console-proxy.spec.ts` 등 기존 e2e 회귀 없음(전체 그린).

- [ ] **Step 3: 커밋**

```bash
git add e2e/plugin-iframe.spec.ts
git commit -m "test(csp): e2e assert dynamic frame-src on plugin tab"
```

---

## Task 5: 문서 갱신

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-06-02-pteron-panel-plugins-6c-ui-iframe.md`

- [ ] **Step 1: README 갱신**

`README.md`에서 다음 문단:

```
CSP `frame-src`를 등록된 플러그인 origin으로 동적으로 제한하는 하드닝은 후속 작업입니다. 현재 구현은 iframe sandbox와 소유자 스코프 토큰 검증으로 격리합니다.
```

을 다음으로 교체:

```
CSP `frame-src`를 등록된 플러그인 origin으로 동적으로 제한합니다(`server.ts`). 기본 정책은 `frame-src 'none'; frame-ancestors 'none'`이고, 플러그인 탭 라우트(`/servers/<id>/plugin/<pluginId>`)에서만 해당 플러그인의 origin을 `frame-src`로 허용합니다. iframe sandbox와 소유자 스코프 토큰 검증으로 추가 격리합니다. (전체 CSP 락다운 — `default-src`/`script-src`/`connect-src` 등 — 은 별도 후속 작업입니다.)
```

- [ ] **Step 2: 6c plan 잔여 하드닝 표기 갱신**

`docs/superpowers/plans/2026-06-02-pteron-panel-plugins-6c-ui-iframe.md`에서 다음 라인:

```
6a(등록·토큰·스코프 API) + 6b(이벤트 webhook) + 6c(UI iframe)로 **외부 통합 플러그인 시스템** 완성. 이로써 로드맵 Phase 0–6이 전부 설계·계획 완료된다. (잔여 하드닝: CSP frame-src 동적 허용, webhook SSRF 사설IP 차단, webhook 전용 큐 — 후속 보안 태스크.)
```

을 다음으로 교체:

```
6a(등록·토큰·스코프 API) + 6b(이벤트 webhook) + 6c(UI iframe)로 **외부 통합 플러그인 시스템** 완성. 이로써 로드맵 Phase 0–6이 전부 설계·계획 완료된다. (잔여 하드닝: webhook SSRF 사설IP 차단, webhook 전용 큐 — 후속 보안 태스크. CSP frame-src 동적 허용은 2026-06-03 구현됨 → `docs/superpowers/specs/2026-06-03-pteron-panel-csp-frame-src-design.md`.)
```

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/superpowers/plans/2026-06-02-pteron-panel-plugins-6c-ui-iframe.md
git commit -m "docs(csp): mark frame-src hardening implemented"
```

---

## Task 6: 전체 검증

- [ ] **Step 1: 단위·정적 전체**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build
```

Expected: 모두 그린. 신규 단위 테스트(`csp.test.ts`, `frame-origin.test.ts`) 포함 통과.

- [ ] **Step 2: e2e 전체 (DB 필요)**

```bash
docker compose -f docker-compose.dev.yml up -d db && pnpm prisma migrate deploy
pnpm e2e
```

Expected: 전체 e2e 그린(플러그인 CSP 단언 + 콘솔 프록시 회귀 없음).

- [ ] **Step 3: 수동 헤더 확인 (선택)**

플러그인 탭 진입 시 응답 헤더 `Content-Security-Policy: frame-src 'self' <plugin-origin>; frame-ancestors 'none'`, 그 외 페이지 `frame-src 'none'; frame-ancestors 'none'` 확인.

---

## Self-Review

**1. Spec coverage:**
- §4.1 server.ts 단일 소유 → Task 3. ✓
- §4.2 정책 문자열(기본/플러그인) → Task 1 `buildFrameCsp` + 테스트. ✓
- §4.3 origin 해석·owner 비스코프·fail-closed → Task 2 `getEnabledPluginUiOrigin` + Task 3 try/catch. ✓
- §4.4 frame-ancestors 추가/X-Frame-Options 유지 → 정책 문자열에 `frame-ancestors 'none'` 포함; next.config 미변경(유지). ✓
- §4.5 모듈 경계(`shouldSetCsp`/`pluginIdFromPath`/`buildFrameCsp`/`getEnabledPluginUiOrigin`) → Task 1·2. ✓
- §6 테스트 전략(순수/조회/e2e) → Task 1·2·4. ✓
- §7 영향 파일(문서 포함) → Task 5. ✓
- §8 검증 → Task 6. ✓

**2. Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드·명령·예상 출력 구체적. ✓

**3. Type consistency:** `buildFrameCsp(pluginOrigin: string | null): string`, `pluginIdFromPath(pathname: string): string | null`, `shouldSetCsp(pathname: string): boolean`, `getEnabledPluginUiOrigin(pluginId: string): Promise<string | null>`, `FRAME_CSP_BASELINE: string` — Task 1·2 정의와 Task 3 사용처 시그니처/이름 일치. server.ts는 `ServerResponse`(node:http) 사용. ✓

---

## Post-review 수정 (독립 리뷰 후 추가)

Codex 구현을 보안/정확성/충실도 병렬 리뷰한 뒤, 아래를 추가로 반영했다(각 항목 TDD·커밋·검증).
설계 근거는 spec §4.3(살균), §4.6(soft-nav 해소) 참조.

- **R1 — origin 살균 (보안).** `getEnabledPluginUiOrigin`이 원시 `URL.origin`을 그대로 반영하면
  소유자가 `https://*.evil.com`(와일드카드)·`https://a.com;x`(`;` 디렉티브 분리)·`javascript:`(opaque
  `"null"`) 같은 `uiTabUrl`로 `frame-src` 헤더를 넓히거나 오염시킬 수 있었다. 깨끗한
  `scheme://host[:port]`만 통과시키고 그 외는 `null`로 떨어뜨림(+ 단위 테스트). 커밋 `fix(csp): sanitize plugin origin ...`.
- **R2 — 플러그인 탭 전체 내비 (soft-nav 결함).** `frame-src`는 문서 수명 고정인데 탭이 `<Link>`(soft nav)라,
  탭 클릭 시 이전 문서의 `frame-src 'none'`이 적용돼 iframe이 차단됐다(프로브로 콘솔 위반 재현). 레이아웃에서
  플러그인 탭만 `<a href>`(전체 리로드)로 렌더. 커밋 `fix(csp): full-load plugin tabs ...`.
- **R3 — e2e 강화.** 헤더를 `page.goto`로만 보던 기존 e2e가 R2를 못 잡았으므로, 실제 탭-클릭 경로에서
  내비 응답의 `frame-src 'self' <origin>` + iframe 로드 + **CSP 위반 콘솔 0건**을 단언(soft-nav 회귀 시 실패).
  커밋 `test(csp): assert plugin iframe loads via tab click ...`.
- **R4 — 문서 정합.** spec에 §4.6(soft-nav 비호환·해소)·§4.3(살균) 추가, 본 plan에 본 절 추가. 커밋 `docs(csp): ...`.

**남은(선택) 후속:** 등록 검증기(`validatePluginUiUrl`)에서 와일드카드/비정상 host를 register 시점에 거부(현재는
emission 시점 살균으로 이미 안전 — UX 차원의 조기 거부). 본 작업 범위 밖.
