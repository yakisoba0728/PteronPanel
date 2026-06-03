# Pteron Panel — CSP `frame-src` 동적 허용 (frame 지시자 한정) 설계

- 날짜: 2026-06-03
- 상태: 승인됨 (구현 대기)
- 분류: 보안 하드닝 (Phase 6c 후속, spec/plan에 "후속 하드닝"으로 명시됨)
- 관련 문서: `docs/superpowers/plans/2026-06-02-pteron-panel-plugins-6c-ui-iframe.md` (§Self-Review, §Phase 6 완료), `README.md:186`

## 1. 배경 / 문제

Phase 6c에서 소유자 플러그인 UI를 `<iframe>`로 임베드하는 탭을 도입했다
(`src/app/(panel)/servers/[id]/plugin/[pluginId]/page.tsx` → `src/features/plugins/plugin-frame.tsx`).
현재 격리는 다음 두 가지에만 의존한다.

- iframe `sandbox="allow-scripts allow-forms"` (allow-same-origin 없음 → opaque origin)
- 컨텍스트 토큰을 `postMessage(payload, targetOrigin = pluginOrigin)`로만 전달

그러나 패널 어디에도 `Content-Security-Policy` 헤더가 없다
(`next.config.mjs`는 `X-Frame-Options: DENY` 등 정적 헤더만 설정). 즉 어떤 페이지든
주입(injection)이 발생하면 임의 origin을 iframe으로 임베드할 수 있고, 브라우저 차원에서
"패널이 무엇을 프레임할 수 있는가"를 제한하는 경계가 없다. 이 항목은 처음부터
후속 하드닝으로 명시되어 있었다(`README.md:186`, 6c plan §Phase 6 완료).

## 2. 위협 모델 / 방어 목표

`frame-src`는 **패널 페이지가 무엇을 임베드할 수 있는지**를 제어한다(임베드 *당하는* 것은
`frame-ancestors`/`X-Frame-Options`). 이 작업이 방어하는 것:

- 신뢰된 패널 chrome 내부에서의 클릭재킹/피싱용 **주입된 iframe**: 전역 `frame-src 'none'`로
  플러그인 탭을 제외한 모든 페이지에서 프레이밍을 차단한다.
- 플러그인 탭 페이지에서도 **등록된 해당 플러그인 origin 외의 프레이밍**을 차단한다.

컨텍스트 토큰 자체는 이미 `postMessage` `targetOrigin`으로 보호되므로(잘못된 프레임은 토큰을
못 받음), 본 작업은 **심층 방어(defense-in-depth)**다. 비-목표는 §4 참고.

## 3. 목표 / 비목표

**목표**

- 모든 문서 라우트에 `frame-src 'none'; frame-ancestors 'none'` 기본 적용.
- 플러그인 탭 라우트(`/servers/<id>/plugin/<pluginId>`)에서만 `frame-src 'self' <등록된 plugin origin>`로
  동적 허용. origin은 DB의 해당 플러그인 `uiTabUrl`에서 도출.
- 구현은 Next 업그레이드 없이, 기존 Node 보안 초크포인트(`server.ts`)에서 수행.
- TDD: 순수 헬퍼 + DB 조회 단위 테스트 + e2e 헤더/동작 단언.

**비목표 (명시적 범위 밖 — 별도 후속)**

- `default-src`/`script-src`/`style-src`/`connect-src`/`img-src` 등 전면 CSP 락다운.
  (Wings 노드 cross-origin 업로드 `connect-src` 동적화, Next 인라인 스크립트 nonce,
  xterm 인라인 스타일 허용 등 대형·고위험 작업 — 본 작업과 분리.)
- CSP 리포팅 엔드포인트(`report-to`/`report-uri`).
- owner별 전역 origin allowlist (한 페이지가 모든 플러그인 origin을 프레임 허용하는 방식)는
  의도적으로 채택하지 않음 — 라우트별 정확 제한이 더 좁다.

## 4. 설계

### 4.1 배치 — 단일 CSP 소유자 = `server.ts`

`createServer` 핸들러에서 Next `handle()`로 위임하기 **전에** `Content-Security-Policy`를
응답 헤더로 set 한다. 근거:

- 동적 plugin origin 도출엔 Node + Prisma가 필요한데, **Next 15.1에는 Node 런타임
  미들웨어(`experimental.nodeMiddleware`, 15.2+)가 없다.** Edge 미들웨어에서는 Prisma 조회 불가.
- `<meta http-equiv>` 방식은 여러 CSP가 **교집합**(가장 엄격한 정책 승)으로 합쳐지므로,
  전역 헤더가 `frame-src 'none'`이면 페이지 메타로 plugin origin을 *추가* 허용할 수 없다.
  또한 `frame-ancestors`는 메타 CSP에서 무시된다.
- `server.ts`는 이미 세션·Origin·DoS 한도를 강제하는 보안 초크포인트이며 `getConfig()`·Prisma
  접근이 가능하다. CSP(보안 헤더)는 여기 두는 것이 기존 패턴과 일치한다.

**미들웨어는 인증 전용으로 그대로 둔다.** 미들웨어와 `server.ts`가 둘 다 CSP를 set 하면 헤더가
2개가 되어 교집합으로 `frame-src 'none'`이 이겨 iframe이 차단된다. CSP는 `server.ts`가 단독 소유한다.

### 4.2 정책 문자열 (frame 지시자만)

`default-src`를 두지 않으므로 **명시한 지시자 외에는 아무것도 제한되지 않는다**
(콘솔 WS, xterm, signed-URL 업로드/다운로드 등 기존 흐름 무영향).

- 기본(모든 문서 라우트): `frame-src 'none'; frame-ancestors 'none'`
- 플러그인 탭 라우트, origin `O` 도출 성공: `frame-src 'self' <O>; frame-ancestors 'none'`
  - `O`는 `new URL(uiTabUrl).origin`(scheme+host[+port], 끝 슬래시 없음) — CSP source-expression으로 유효.
  - `'self'`는 관례상 포함(무해, 향후 same-origin 프레임 대비). 실제 iframe src는 외부 origin.
- `/_next/*`, `/api/*`, `/favicon.ico` 등은 CSP set 생략(불필요·무해).

### 4.3 origin 해석 + 권한/실패 처리

- 경로에서 `pluginId` 추출: 정규식 `^/servers/[^/]+/plugin/([^/]+)/?$`의 capture group 1.
- 조회: `prisma.plugin.findFirst({ where: { id: pluginId, enabled: true, uiTabUrl: { not: null } }, select: { uiTabUrl: true } })`.
  성공 시 `new URL(uiTabUrl).origin`을 **살균**해 반환, 아니면 `null`.
- **origin 살균**(헤더 인젝션 방지): 도출한 origin이 깨끗한 `scheme://host[:port]`
  (정규식 `^https?://([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d+)?$`)일 때만 반환하고, 그 외( `*`·`;`·`,`·공백
  등 CSP 의미 문자, 또는 비-http(s) opaque origin `"null"`)는 `null`로 떨어뜨린다. 등록 검증이
  https-only이긴 하나, `frame-src` 헤더에 들어가는 값은 emission 시점에서 한 번 더 보장한다.
- **owner 스코프 안 함**: origin 문자열은 비밀이 아니고(외부 URL), 페이지 자체가
  `ownerId: user.id`로 `notFound()`를 강제한다. 타 유저의 pluginId로 접근해도 `frame-src`엔
  그 origin이 들어가지만 페이지가 404라 iframe이 렌더되지 않음 → 누출 없음. (세션을 미들웨어/서버에서
  다시 검증해 owner 스코프까지 거는 것은 추가 DB 비용 대비 이득이 없어 채택하지 않음.)
- **Fail-closed**: 조회 미스/`uiTabUrl` 파싱 실패/DB 에러 → 기본 `frame-src 'none'`
  (어차피 페이지도 404). 어떤 경우에도 핸들러에서 throw가 새어나가지 않게 try/catch로 감싼다.
- 비용: 플러그인 라우트 진입 시에만 인덱스 PK 1회 조회. 그 외 라우트는 DB 호출 없음.

### 4.4 `frame-ancestors` vs `X-Frame-Options`

- `next.config.mjs`의 `X-Frame-Options: DENY`는 구형 브라우저용으로 **유지**.
- 새 CSP에 `frame-ancestors 'none'`을 추가(현대 등가물). 패널은 임베드 대상이 아니다.

### 4.5 모듈 경계

- `src/lib/security/csp.ts` — 순수 함수만:
  - `shouldSetCsp(pathname: string): boolean` (`/_next/`,`/api/`,`/favicon.ico` 제외)
  - `pluginIdFromPath(pathname: string): string | null`
  - `buildFrameCsp(pluginOrigin: string | null): string`
  - 상수 `FRAME_CSP_BASELINE = "frame-src 'none'; frame-ancestors 'none'"`
- `src/lib/plugins/frame-origin.ts` — `getEnabledPluginUiOrigin(pluginId: string): Promise<string | null>` (Prisma 조회 + origin 도출, 실패 시 null).
- `server.ts` — 위 둘을 사용해 `handle()` 전에 헤더 주입. 대략:

  ```ts
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

  const server = createServer(async (req, res) => {
    const parsed = parse(req.url!, true);
    await applyCspHeader(res, parsed.pathname ?? '/');
    handle(req, res, parsed);
  });
  ```

  `applyCspHeader`는 내부 try/catch로 절대 reject하지 않으므로 `handle()`은 항상 실행된다.
  업그레이드(WS) 핸들러는 변경 없음.

### 4.6 SPA soft-nav 비호환과 해소 (리뷰 발견)

**문제:** `frame-src`는 **문서(document) 수명 동안 고정**되는 정책이다(응답 헤더로 한 번 설정되면
그 문서가 살아있는 한 클라이언트 측 라우팅으로 바뀌지 않는다). 이 앱의 서버뷰 탭은 Next `<Link>`로
**soft nav**(문서 교체 없는 클라이언트 전환)된다. 따라서 사용자가 `/servers/<id>`(→`frame-src 'none'`)를
로드한 뒤 플러그인 탭을 클릭하면 문서가 그대로라 원래의 `'none'`이 적용되어 **iframe이 차단된다**
(브라우저 콘솔: `Refused/Framing ... violates ... frame-src 'none'`). 직접 URL 로드/새로고침일 때만 동작한다.
e2e가 헤더를 `page.goto`(하드 내비)로만 확인하고 iframe의 실제 *로드*를 단언하지 않아 최초 구현에서 놓쳤다.

**해소(채택):** 플러그인 탭 링크만 **전체 내비게이션**(`<a href>`)으로 렌더해, 각 플러그인 탭이 자기
origin만 허용하는 **새 문서**로 로드되게 한다(`src/app/(panel)/servers/[id]/layout.tsx`에서 탭 key가
`plugin:`로 시작하면 `<a>`, 그 외는 `<Link>`). per-route 타이트 CSP를 유지하면서 iframe이 정상 로드된다.
대가는 플러그인 탭 진입 시 전체 리로드(허용 가능 — iframe 뷰는 본래 무겁다).

**대안(미채택): 소유자 스코프 allowlist.** 모든 인증 문서에 그 사용자의 enabled 플러그인 origin 전체를
`frame-src`로 실으면 soft-nav UX를 유지하나, frame-src가 (자기 소유) 여러 origin으로 넓어지고 문서 로드마다
세션검증+`findMany`가 필요하다. 보안 손실은 작지만(전부 자기 소유 origin) 본 작업의 "정확 1개 origin" 의도와
멀어져 미채택.

**회귀 방지:** e2e는 실제 탭-클릭 경로로 진입해 (a) 내비 응답의 `frame-src 'self' <origin>`, (b) iframe 로드,
(c) **CSP 위반 콘솔 메시지 0건**을 단언한다. 탭이 다시 soft-nav로 바뀌면 (c)에서 실패한다.

## 5. 대안 및 기각 사유

- **Node 미들웨어 + Prisma 조회**: 개념상 가장 깔끔하나 Next 15.1→15.2+ 업그레이드 필요
  (범위·리스크 증가). 기각.
- **정적 `next.config.mjs` 라우트별 헤더** (`frame-src 'self' https:` on 플러그인 라우트):
  DB 불필요·단순하나 "아무 https origin이나 허용"이라 "등록된 플러그인 origin" 요건 미충족. 기각.
- **`<meta http-equiv>` 페이지 레벨 CSP**: 다중 CSP 교집합으로 막히고 `frame-ancestors` 무시. 기각.

## 6. 테스트 전략 (TDD — 구현 전 작성)

- `src/lib/security/csp.test.ts` (순수, DB 불필요):
  - `pluginIdFromPath`: `/servers/abc/plugin/pl1` → `pl1`; 끝 슬래시 허용; `/servers/abc` → null;
    `/servers/abc/plugin/pl1/extra` → null; `/login` → null.
  - `buildFrameCsp(null)` → `frame-src 'none'; frame-ancestors 'none'`.
  - `buildFrameCsp('https://x.example')` → `frame-src 'self' https://x.example; frame-ancestors 'none'`.
  - `shouldSetCsp`: `/_next/x`,`/api/x`,`/favicon.ico` → false; `/servers/...` → true.
- `src/lib/plugins/frame-origin.test.ts` (Prisma 목 — `owner-tabs.test.ts` 패턴 차용):
  - enabled+uiTabUrl 있음 → `new URL(uiTabUrl).origin`.
  - disabled/uiTabUrl null/미존재 → null.
  - 잘못된 uiTabUrl(파싱 불가) → null (throw 아님).
- e2e (`e2e/plugin-iframe.spec.ts` 확장):
  - 플러그인 탭 응답의 `content-security-policy`에 `frame-src 'self' <plugin origin>` 포함, iframe 정상 로드.
  - 일반 패널 페이지 응답은 `frame-src 'none'` 포함.
  - `e2e/console-proxy.spec.ts` 회귀 없음(콘솔 정상 동작) 확인.

## 7. 영향 파일

- 신규: `src/lib/security/csp.ts`, `src/lib/security/csp.test.ts`
- 신규: `src/lib/plugins/frame-origin.ts`, `src/lib/plugins/frame-origin.test.ts`
- 수정: `server.ts` (헤더 주입 배선)
- 수정: `e2e/plugin-iframe.spec.ts` (CSP 단언 추가)
- 문서: `README.md:186` ("후속 작업" → "구현됨" + 동작 기술), 6c plan §Phase 6 완료의 잔여 하드닝 목록에서 본 항목 갱신
- `next.config.mjs`: 변경 없음(X-Frame-Options 유지). CSP는 `server.ts` 소유.

## 8. 검증

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build
# DB 필요한 통합/e2e:
docker compose -f docker-compose.dev.yml up -d db && pnpm prisma migrate deploy
pnpm e2e
```

수동 확인: 플러그인 탭 진입 후 응답 헤더에 `Content-Security-Policy: frame-src 'self' https://<plugin>; frame-ancestors 'none'`,
다른 페이지는 `frame-src 'none'; frame-ancestors 'none'`.

## 9. 롤백/리스크

- frame 지시자만 설정하므로 콘솔/xterm/업로드 등 기타 흐름에 영향 없음(리스크 낮음).
- 잘못된 정규식/조회로 plugin origin이 누락되면 iframe만 안 보이고 나머지는 정상 — fail-closed.
- 단일 인스턴스 가정과 무관(헤더는 요청별 stateless 계산).
