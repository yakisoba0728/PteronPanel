# Pteron Panel — Console WebSocket Proxy (subuser permission enforcement) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 콘솔의 `set state`(전원)·`send command`(명령) 프레임을 **서버측에서 서브유저 권한으로 강제**한다. 현재는 브라우저→Wings WebSocket 직결이고 토큰이 root-admin 키로 발급돼 `["*"]` 권한을 가지므로, `control.console`만 가진 서브유저도 전원/명령이 가능한 **권한 우회(CRITICAL)** 가 있다. 이를 **Next 서버측 WS 프록시**(브라우저↔Next↔Wings)로 닫는다. 부수효과: 브라우저가 Wings 토큰조차 받지 않아 토큰 노출도 사라진다.

**Architecture:** Next App Router의 Route Handler는 WS 업그레이드를 직접 지원하지 않으므로 **커스텀 Node 서버**(`server.ts`)로 Next 요청 핸들러 + `ws` 업그레이드 핸들러를 함께 띄운다. 프록시는 업그레이드 요청의 **세션 쿠키를 검증**하고(기존 `validateSessionToken`), 요청 서버에 대한 **accessKind/permissions를 해석**한 뒤(기존 authz), **upstream Wings WS를 admin 토큰으로** 열고(기존 `getWebsocketCredentials`), **프레임 정책**으로 inbound를 필터링하며 양방향 중계한다. 토큰 발급·`auth`·갱신은 **프록시(서버)가 담당**한다. 클라이언트(`ConsoleSocket`)는 동일 출처 프록시에 붙고 더 이상 Wings 토큰을 다루지 않는다.

**Tech Stack:** 기존 + `ws`(Node WebSocket). **선행:** Phase 1–5 완료(특히 콘솔·서브유저·스코프·`requireServerAccess`가 accessKind/permissions 제공). 참조 spec: 부록 A §4(콘솔 WS·이벤트·토큰), §A.4 inbound 게이팅(`send command`=control.console, `set state`=control.start/stop/restart), §15, 그리고 Phase 5 리뷰 CRITICAL-A.

> **표준 규칙:** 각 Task commit + push(작업 브랜치). **AI 워터마크 금지.** **워크트리**에서 작업.
> **⚠️ 배포 영향:** 엔트리포인트가 `next start`/standalone `server.js` → **커스텀 `server.ts`** 로 바뀐다. Docker CMD·README·리버스 프록시 WS 업그레이드 설정을 갱신한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/console/frame-policy.ts` | 프레임 허용 판정(순수) |
| `src/lib/console/proxy.ts` | 단일 콘솔 세션 중계 로직(브라우저소켓↔Wings소켓, 정책 적용, 토큰 갱신) |
| `server.ts` | 커스텀 Node 서버: Next 핸들러 + `/api/console/ws` 업그레이드 |
| `src/features/console/socket.ts`(수정) | 프록시 동일출처 WS로 연결(토큰 비취급) |
| `src/server/console.ts`(수정) | `getConsoleCredentials` 제거 또는 내부화(프록시가 사용) |
| `package.json`, `Dockerfile`, `docker-compose.yml`, `README.md`(수정) | 엔트리포인트·배포 |

---

## Task 1: 프레임 정책 (순수 함수) [TDD]

**Files:**
- Create: `src/lib/console/frame-policy.ts`, `src/lib/console/frame-policy.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/console/frame-policy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isInboundAllowed } from './frame-policy';

const owner = { accessKind: 'owner' as const, permissions: [] as string[] };
const sub = (perms: string[]) => ({ accessKind: 'subuser' as const, permissions: perms });

describe('isInboundAllowed', () => {
  it('owners/admins may send anything', () => {
    expect(isInboundAllowed(owner, { event: 'set state', args: ['kill'] })).toBe(true);
    expect(isInboundAllowed({ accessKind: 'admin', permissions: [] }, { event: 'send command', args: ['op me'] })).toBe(true);
  });
  it('subuser send command requires control.console', () => {
    expect(isInboundAllowed(sub(['control.console']), { event: 'send command', args: ['say hi'] })).toBe(true);
    expect(isInboundAllowed(sub([]), { event: 'send command', args: ['say hi'] })).toBe(false);
  });
  it('subuser set state requires the matching control.* permission', () => {
    expect(isInboundAllowed(sub(['control.start']), { event: 'set state', args: ['start'] })).toBe(true);
    expect(isInboundAllowed(sub(['control.start']), { event: 'set state', args: ['stop'] })).toBe(false);
    expect(isInboundAllowed(sub(['control.stop']), { event: 'set state', args: ['kill'] })).toBe(true); // kill→stop
  });
  it('always allows auth and read-only requests', () => {
    expect(isInboundAllowed(sub([]), { event: 'auth', args: ['x'] })).toBe(true);
    expect(isInboundAllowed(sub([]), { event: 'send logs', args: [] })).toBe(true);
    expect(isInboundAllowed(sub([]), { event: 'send stats', args: [] })).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`src/lib/console/frame-policy.ts`:
```ts
export type AccessKind = 'owner' | 'admin' | 'subuser';
export interface Viewer { accessKind: AccessKind; permissions: string[]; }
export interface InboundFrame { event: string; args?: string[]; }

const STATE_PERMISSION: Record<string, string> = {
  start: 'control.start', stop: 'control.stop', restart: 'control.restart', kill: 'control.stop',
};

/** Whether a browser→Wings frame is permitted for this viewer. Owners/admins: all. */
export function isInboundAllowed(viewer: Viewer, frame: InboundFrame): boolean {
  if (viewer.accessKind !== 'subuser') return true;
  const held = new Set(viewer.permissions);
  switch (frame.event) {
    case 'auth':
    case 'send logs':
    case 'send stats':
      return true; // connect/read-only (membership already verified)
    case 'send command':
      return held.has('control.console');
    case 'set state': {
      const perm = STATE_PERMISSION[frame.args?.[0] ?? ''];
      return perm ? held.has(perm) : false;
    }
    default:
      return false; // unknown inbound events are dropped
  }
}
```

- [ ] **Step 3: 통과 + Commit + Push**

```bash
pnpm vitest run src/lib/console/frame-policy.test.ts
git add src/lib/console/frame-policy.ts src/lib/console/frame-policy.test.ts
git commit -m "feat(console): inbound frame permission policy"
git push
```

---

## Task 2: 콘솔 세션 프록시 로직

**Files:**
- Create: `src/lib/console/proxy.ts`

> 단일 브라우저 WS ↔ 단일 Wings WS 중계. 서버측에서 `auth`/토큰 갱신 처리, inbound는 `isInboundAllowed`로 필터, outbound는 그대로 전달. `ws` 라이브러리 사용.

- [ ] **Step 1: `ws` 추가**

Run: `pnpm add ws && pnpm add -D @types/ws`

- [ ] **Step 2: 프록시 작성**

`src/lib/console/proxy.ts`:
```ts
import WebSocket from 'ws';
import { getWebsocketCredentials } from '@/lib/ptero/client';
import { asIdentifier } from '@/lib/ptero/types';
import { isInboundAllowed, type Viewer } from './frame-policy';

const REFRESH_MS = 8 * 60 * 1000; // proactively refresh the Wings token

/** Bridge a browser socket to the server's Wings console socket, enforcing `viewer` permissions on inbound frames. */
export async function bridgeConsole(browser: WebSocket, identifier: string, viewer: Viewer): Promise<void> {
  const id = asIdentifier(identifier);
  let creds = await getWebsocketCredentials(id);
  const upstream = new WebSocket(creds.socket);
  let refreshTimer: NodeJS.Timeout | null = null;

  const authUpstream = () => upstream.send(JSON.stringify({ event: 'auth', args: [creds.token] }));

  upstream.on('open', () => {
    authUpstream();
    refreshTimer = setInterval(async () => {
      try { creds = await getWebsocketCredentials(id); authUpstream(); }
      catch { /* will retry next tick */ }
    }, REFRESH_MS);
  });
  // Wings → browser: pass through
  upstream.on('message', (data) => { if (browser.readyState === WebSocket.OPEN) browser.send(data.toString()); });
  upstream.on('close', (code) => { if (browser.readyState === WebSocket.OPEN) browser.close(code); });
  upstream.on('error', () => { if (browser.readyState === WebSocket.OPEN) browser.close(1011); });

  // Browser → Wings: the proxy injects auth itself, drops client-sent `auth`, and filters by permission
  browser.on('message', (raw) => {
    let frame: { event: string; args?: string[] };
    try { frame = JSON.parse(raw.toString()); } catch { return; }
    if (frame.event === 'auth') return; // proxy owns auth; ignore client auth
    if (!isInboundAllowed(viewer, frame)) {
      browser.send(JSON.stringify({ event: 'daemon error', args: ['권한이 없습니다.'] }));
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(raw.toString());
  });
  const cleanup = () => { if (refreshTimer) clearInterval(refreshTimer); if (upstream.readyState === WebSocket.OPEN) upstream.close(); };
  browser.on('close', cleanup);
  browser.on('error', cleanup);
}
```

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add src/lib/console/proxy.ts package.json pnpm-lock.yaml
git commit -m "feat(console): server-side WS bridge with permission filtering"
git push
```

---

## Task 3: 커스텀 Node 서버 (Next + WS 업그레이드)

**Files:**
- Create: `server.ts`
- Modify: `package.json`(scripts)

- [ ] **Step 1: 커스텀 서버 작성**

`server.ts` (프로젝트 루트):
```ts
import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { WebSocketServer } from 'ws';
import { validateSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/constants';
import { resolveAccessibleServers } from '@/lib/authz/access';
import { bridgeConsole } from '@/lib/console/proxy';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.split('=')[1];
}

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res, parse(req.url!, true)));
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const { pathname, query } = parse(req.url!, true);
    if (pathname !== '/api/console/ws') return socket.destroy();
    try {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const session = token ? await validateSessionToken(token) : null;
      if (!session) return socket.destroy();
      const identifier = String(query.server ?? '');
      const servers = await resolveAccessibleServers({ id: session.user.id, role: session.user.role, pteroUserId: session.user.pteroUserId });
      const match = servers.find((s) => s.identifier === identifier);
      if (!match) return socket.destroy(); // not a member → no console
      const viewer = { accessKind: match.accessKind ?? 'subuser', permissions: match.permissions ?? [] };
      wss.handleUpgrade(req, socket, head, (browser) => { void bridgeConsole(browser, identifier, viewer); });
    } catch {
      socket.destroy();
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`> ready on :${port}`));
});
```
> `AccessibleServer`에 `accessKind`/`permissions`가 있어야 한다(Phase 4c/5에서 추가됨). 없으면 `resolveAccessibleServers`가 이를 포함하도록 보강(소유=owner/admin, 캐시행=subuser+permissions).

- [ ] **Step 2: 엔트리포인트 스크립트**

`package.json` scripts 수정:
```json
"dev": "tsx watch server.ts",
"start": "NODE_ENV=production node --import tsx server.ts"
```
> 또는 빌드 시 `server.ts`를 `tsc`/`tsx`로 번들. standalone과의 통합은 Step 4 Docker에서 처리.

- [ ] **Step 3: 타입체크 + Commit + Push**

```bash
pnpm typecheck
git add server.ts package.json
git commit -m "feat(server): custom Node server with /api/console/ws upgrade"
git push
```

---

## Task 4: 클라이언트 콘솔을 프록시로 전환

**Files:**
- Modify: `src/features/console/socket.ts`, `src/features/console/console-view.tsx`, `src/server/console.ts`

- [ ] **Step 1: `ConsoleSocket`을 동일출처 프록시에 연결**

`src/features/console/socket.ts` 수정: 더 이상 `getConsoleCredentials`로 `{token, socket}`을 받지 않고, 동일 출처 프록시 URL에 연결한다. `auth` 전송 로직 제거(프록시가 담당). 토큰 갱신 로직도 제거(프록시가 담당). 연결 URL:
```ts
const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/console/ws?server=${encodeURIComponent(identifier)}`;
```
나머지(이벤트 디스패치·재연결 백오프·4409 처리)는 유지. 재연결 시에도 토큰 재발급 호출 없음.

- [ ] **Step 2: `console-view.tsx` 정리**

`getConsoleCredentials` 의존 제거. (Phase 5에서 추가한 UI 게이팅은 **defense-in-depth로 유지** — 서버가 강제하지만 버튼을 숨기는 게 UX상 옳음.)

- [ ] **Step 3: `getConsoleCredentials` 내부화/제거**

`src/server/console.ts`: 브라우저가 더는 호출하지 않으므로 export를 제거하거나, 프록시 전용 내부 함수로 남긴다(프록시는 `getWebsocketCredentials`를 직접 사용하므로 액션 자체가 불필요할 수 있음). 사용처가 사라졌는지 확인 후 정리.

- [ ] **Step 4: 타입체크·빌드 + Commit + Push**

```bash
pnpm typecheck && pnpm build
git add src/features/console/ src/server/console.ts
git commit -m "feat(console): connect browser console to same-origin server proxy"
git push
```

---

## Task 5: 배포(커스텀 서버) + 문서

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `README.md`

- [ ] **Step 1: Dockerfile CMD를 커스텀 서버로**

standalone 출력 대신(또는 함께) 커스텀 서버를 실행하도록 `Dockerfile`의 `runner` 단계를 조정한다. 핵심: 런타임에 `tsx`(또는 사전 컴파일된 `server.js`) + Next 빌드 산출물 + `node_modules`(ws 포함)이 있어야 한다. 가장 단순: `runner`에 전체 의존성 설치(또는 `next build` 후 `next start` 대신 `node --import tsx server.ts`). `CMD ["pnpm", "start"]`로 변경.
> `output:'standalone'`은 자체 `server.js`를 만들지만 우리는 커스텀 서버를 쓰므로, standalone 대신 일반 빌드 + 런타임 의존성 포함 방식이 단순할 수 있다. 빌드가 통과하고 `/api/console/ws`가 동작하면 OK.

- [ ] **Step 2: 리버스 프록시 WS 문서**

`README.md`에 추가: 콘솔이 이제 **동일 출처 `/api/console/ws`** 를 쓰므로, 리버스 프록시(Nginx/Caddy)에서 **WebSocket 업그레이드 헤더 통과** 설정 필요. 더불어 **Wings `allowed_origins`** 는 이제 *Pteron 서버*의 출처만 필요(브라우저가 직접 안 붙음) — 단, Wings에 붙는 건 Pteron 서버이므로 origin 검사 영향 재확인.

- [ ] **Step 3: 빌드 검증 + Commit + Push**

```bash
pnpm build && docker compose build
git add Dockerfile docker-compose.yml README.md
git commit -m "feat(deploy): run custom server; document WS proxy + reverse proxy"
git push
```

---

## Task 6: e2e (서브유저 권한 강제) + 최종 검증

**Files:**
- Modify: `e2e/mock-panel.mjs`(Wings WS mock가 프레임 수신 검증), `e2e/subusers.spec.ts` 또는 신규 `e2e/console-proxy.spec.ts`

- [ ] **Step 1: e2e — 권한 없는 서브유저의 전원/명령이 차단되는지**

mock Wings WS가 수신 프레임을 기록하게 하고, `control.start` 없는 서브유저가 콘솔에서 start를 시도하면 **Wings에 set state가 전달되지 않음**(프록시가 차단)을 검증. (시드 서브유저에 제한 권한 부여.)

- [ ] **Step 2: 전체 검증**

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm e2e
```
Expected: 전부 그린. frame-policy 단위 + 프록시 차단 e2e 포함.

- [ ] **Step 3: Commit + Push**

```bash
git add e2e/
git commit -m "test(e2e): proxy blocks unauthorized subuser power/command frames"
git push
```

---

## Self-Review (작성자 체크리스트)

- **CRITICAL-A 해소:** inbound `set state`/`send command`가 서버측 프록시에서 `isInboundAllowed`로 강제됨. 브라우저는 Wings 토큰을 받지 않음(토큰 노출 제거). 소유자/관리자는 전부 허용.
- **보안:** 업그레이드 시 세션 검증 + 멤버십(`resolveAccessibleServers`) 확인 → 비멤버 연결 거부. 권한은 서버가 보유한 accessKind/permissions로 판정(클라이언트 입력 아님). 두 키는 여전히 서버 전용.
- **회귀:** Phase 5의 UI 게이팅은 defense-in-depth로 유지. 콘솔 기능(출력·통계·재연결·4409)은 그대로.
- **배포 영향 명시:** 커스텀 서버 엔트리포인트·리버스 프록시 WS·standalone 조정.
- **리스크:** Next 커스텀 서버 + standalone 통합은 환경 의존이 있어 빌드/런 검증을 Task 3·5에서 확실히. WS 부하(서버가 N개 연결 보유)는 단일 인스턴스 MVP 허용, 대규모는 수평 확장 시 sticky/별도 WS 서비스 검토(후속).

---

## 비고
이 계획은 Phase 5 리뷰의 CRITICAL-A에 대한 **정식 수정**이다. 적용 후엔 서브유저 콘솔 권한이 서버측에서 강제된다. 적용 전까지는 Phase 5의 UI 게이팅이 부분 완화로 동작한다.
