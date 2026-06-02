# Pteron Panel — 설계 문서 (Design Spec)

| 항목 | 값 |
|---|---|
| 날짜 | 2026-06-02 |
| 상태 | **Draft (검토 대기)** |
| 대상 | Pterodactyl Panel **1.11.x** + Wings **1.11.x** |
| 스택 | Next.js(App Router, TypeScript) 풀스택 · Prisma · PostgreSQL · Tailwind/shadcn-ui · xterm.js |
| 배포 | 셀프호스트 Docker Compose |
| 개발 방식 | 바이브 코딩 / 유지보수 우선 |
| 검증 | Panel `v1.11.11` · Wings `v1.11.13` **소스 코드 레벨 검증 완료** (부록 A) |

---

## 0. 요약 (TL;DR)

**Pteron Panel**은 Pterodactyl Panel의 **커스텀 멀티테넌트 프론트엔드**다. 자체 유저 DB와 로그인을 가지며, Pterodactyl에는 **딱 두 개의 마스터 키**(Application API Key + **root-admin** Client API Key)로만 접속한다. 백엔드(Next.js 서버)가 두 키를 보관하고 모든 Panel 호출을 대행하며, 응답을 **로그인한 유저가 접근 가능한 서버로 스코프(필터링)** 한다. 콘솔만 예외로, 브라우저가 Client API로 발급받은 1회성 토큰을 들고 **Wings WebSocket에 직접** 연결한다.

이 문서는 **(A) 전체 로드맵(포괄 계획, §16)** 과 **(B) 첫 슬라이스 = Phase 0(기반) + Phase 1(클라이언트 수직 슬라이스)의 상세 설계(§3–§15, §18)** 를 함께 담는다. 후속 Phase(파일·백업·관리자·플러그인 등)는 각자 자체 spec → 계획 → 구현 사이클을 가진다.

---

## 1. 목표 / 비목표

### 목표
- Pterodactyl을 **두 키로만** 운용하는 멀티테넌트 패널. 엔드유저는 Pteron 계정으로 로그인하고 **자기 서버만** 본다.
- 첫 슬라이스에서 **로그인 → 내 서버 목록 → 서버 개요/전원 → 실시간 콘솔**까지 동작.
- 바이브 코딩·유지보수에 최적화된 **단일 언어(TypeScript)·단일 배포물** 구조.
- 향후 **공식 사용자 플러그인 시스템**(§17)을 수용할 수 있는 확장 seam을 기반에 심어둔다(상세 구현은 후속).

### 비목표 (첫 슬라이스 기준)
- 파일 매니저·백업·DB·스케줄·관리자 CRUD·플러그인 실제 구현 (→ Phase 2+).
- 서브유저(소유자가 아닌 공유 접근) 스코프 (→ Phase 4, §4.5).
- 셀프 회원가입·이메일 인증 (→ 후속). MVP는 admin이 계정을 생성·매핑.
- i18n 실제 번역(자리만 마련) / 모바일 전용 최적화.

---

## 2. 핵심 결정 사항 (확정)

| # | 결정 | 값 | 근거 |
|---|---|---|---|
| D1 | API 타겟 | **Panel API**(Application + Client). Wings는 동작 레퍼런스 | "두 키" 요구와 일치 |
| D2 | 범위 | **풀 패널**(관리자 + 클라이언트), 단계적 분해 | §16 로드맵 |
| D3 | 인증 모델 | **멀티테넌트** — 자체 유저 DB + Pterodactyl 매핑 + 백엔드 스코프 | |
| D4 | 스택 | **Next.js 풀스택(TS)** + Prisma + PostgreSQL | 단일 언어·타입 공유·바이브 코딩 |
| D5 | 배포 | 셀프호스트 **Docker Compose** | Wings/Panel 사설망 근접 |
| D6 | 세션 | **명시적 DB 세션**(opaque 토큰 쿠키 + `Session` 테이블) | 즉시 취소 가능·감사·보안 민감성. (Auth.js Credentials는 DB 세션 마찰로 제외) |
| D7 | 라이브 데이터 경로 | 통계·전원·명령은 **WebSocket 우선**(브라우저↔Wings 직결) | Client REST 720/분 공유 버킷 절약 (§4.4) |
| D8 | MVP 스코프 | **소유 서버만**(+admin은 전체). 서브유저는 Phase 4 | 서브유저 열거 API 부재(§4.5) |
| D9 | 첫 슬라이스 | **Phase 0 + Phase 1** | 전 아키텍처 축을 조기 검증 |

---

## 3. 시스템 아키텍처

### 3.1 레이어

```
┌──────────────────────────────────────────────────────────────┐
│  브라우저 (React UI / RSC)                                     │
│   · 쿠키(opaque 세션 토큰, httpOnly)                            │
│   · 콘솔: xterm.js → Wings WebSocket 직접 연결                  │
└───────────────┬──────────────────────────────┬───────────────┘
                │ Server Actions / Route Handler │ WebSocket(직접)
                ▼                                ▼
┌──────────────────────────────────────────┐   │
│  Next.js 서버 (Node 런타임)                │   │
│   1. 세션 검증  (lib/auth)                  │   │
│   2. 인가·스코프 (lib/authz)  ← 핵심        │   │
│   3. Panel API 호출 (lib/ptero)            │   │
│        ├─ Application Key → /api/application │   │
│        └─ Client(admin) Key → /api/client   │   │
│   4. 에러 정규화 / 레이트리밋 / 감사로그     │   │
└───────┬───────────────────────┬────────────┘   │
        │ Prisma                │ HTTPS            │
        ▼                       ▼                  ▼
┌────────────────┐   ┌────────────────────┐   ┌──────────────┐
│ PostgreSQL     │   │ Pterodactyl Panel  │──▶│ Wings 노드들  │
│ 유저/매핑/세션 │   │ /api/application   │   │ (콘솔 WS,     │
│ /감사로그      │   │ /api/client        │   │  파일·백업)   │
└────────────────┘   └────────────────────┘   └──────────────┘
                           ▲                          ▲
                           └── 브라우저는 여기 직접 안 감 ─┘
              (콘솔 WS 토큰만 Client API가 발급 → 브라우저가 Wings로 직접)
```

### 3.2 두 키 모델 & 보안 원칙

- **키는 서버에만 존재**한다. `PTERO_APP_KEY`(`ptla_…`)와 `PTERO_CLIENT_KEY`(`ptlc_…`, root-admin 유저 소유)는 환경변수로만 주입되고 **브라우저로 절대 전송되지 않는다.**
- 모든 Panel 호출은 **Next 서버**가 대행한다. UI는 Panel API URL이나 키를 알지 못한다.
- 브라우저가 외부(Wings)와 직접 통신하는 유일한 경우는 **콘솔 WebSocket**과 **서명된 1회성 파일/백업 URL**(Phase 2)뿐이며, 둘 다 **단시간·범위 제한 토큰**이다(키 아님).
- 모든 변경(mutation)은 **Server Actions**를 통과하며, 그 안에서 세션 검증 → 인가 가드 → 감사로그를 거친다.

### 3.3 데이터 흐름 개요 (읽기/쓰기)
- **읽기**: RSC(Server Component) 또는 Server Action → `lib/authz`로 스코프 → `lib/ptero`로 Panel 호출 → 정규화 → UI.
- **쓰기**: Client Component → Server Action → 세션·인가·검증 → `lib/ptero` → 감사로그 → 결과.
- **실시간**: 브라우저 → Server Action `getConsoleCredentials` → `{token, socket}` → 브라우저가 Wings WS 직접.

---

## 4. 멀티테넌트 인가·스코프 모델 (핵심)

> 이 패널의 보안은 전적으로 이 레이어에 달려 있다. 두 키는 마스터 키라 그 자체로 모든 서버에 접근되므로, **"누가 어떤 서버를 볼 수 있는가"는 Pteron 백엔드가 강제**한다.

### 4.1 접근 가능 서버 해석 — `lib/authz/access.ts`

```
resolveAccessibleServers(user): Promise<AccessibleServer[]>
```
- **user.role === ADMIN** → `client.listServers({ type: 'admin-all' })` → 패널 전체 서버. (부록 A §3.0 검증: root_admin만 admin-all로 전체를 받음.)
- **user.role === USER** → `application.getUser(user.pteroUserId, { include: 'servers' })` → `relationships.servers` = **소유 서버**. (검증: `UserTransformer.includeServers` = `owner_id` 기준.)
  - MVP는 **소유 서버만**. 서브유저 접근은 §4.5(Phase 4).
- 결과 항목 `AccessibleServer`는 **세 식별자**를 모두 담는다: `{ numericId, identifier(8자), uuid(36자), name, node }`.
- `user.pteroUserId`가 없으면(미매핑 USER) 빈 집합 → 아무 서버도 못 봄.

### 4.2 가드 — `lib/authz/guard.ts`

```
requireServerAccess(user, identifier): Promise<AccessibleServer>
```
- 모든 **서버 스코프** Server Action/Route Handler의 첫 줄에서 호출.
- `resolveAccessibleServers(user)`의 집합에 `identifier`가 없으면 **404로 위장한 거부**(존재 은닉; Pterodactyl 자신도 동일하게 404 반환 — 부록 A §7).
- 통과 시 해당 `AccessibleServer`를 반환해 후속 호출이 올바른 식별자를 쓰게 한다.

### 4.3 캐시
- `resolveAccessibleServers`는 **유저별 인메모리 캐시**(TTL 30–60초, LRU)로 감싼다. 콘솔을 열거나 목록을 새로고칠 때마다 Panel을 재호출하지 않기 위함.
- 무효화 훅: 매핑 변경/서버 생성·삭제(관리자 액션) 시 해당 유저(또는 전체) 캐시 무효화.
- 단일 인스턴스 배포 전제(MVP). 다중 인스턴스 확장 시 Redis 캐시로 교체(후속, seam만 유지).

### 4.4 레이트리밋 전략 (⚠️ 중요)
- Client API는 **유저 UUID당 720req/분**, Application은 **240req/분**(부록 A §1). 우리는 **모든 유저의 런타임 작업을 단일 admin Client 키**(=하나의 UUID)로 보내므로, **그 한 키가 전체 트래픽의 720/분을 공유**한다.
- **완화책(설계 원칙 D7):**
  1. **라이브 통계·전원·명령은 REST가 아니라 WebSocket으로.** 브라우저↔Wings 직결이라 **Panel 버킷을 전혀 쓰지 않는다.** (`GET /resources` 폴링 금지.)
  2. 서버 목록은 **세션 캐시**(§4.3).
  3. 콘솔 토큰 발급(`GET …/websocket`)만 REST를 쓰며 1회/≈8분/오픈콘솔 수준 → 충분히 여유.
  4. `lib/ptero/http.ts`가 **429 백오프**(Retry-After)와 `X-RateLimit-Remaining` 모니터링.
- 비상시 패널 측 `APP_API_CLIENT_RATELIMIT` 상향이 가능하나 이는 Pterodactyl 운영 설정이며 우리 제어 밖 — 문서로만 안내.

### 4.5 식별자 3종 (혼동 차단)
| 식별자 | 형태 | 사용처 |
|---|---|---|
| `numericId` | number | **Application API** 경로(`/users/{id}`, `/servers/{id}`) |
| `identifier` (uuidShort) | 8자 문자열 | **Client API** 경로(`/client/servers/{identifier}/…`) |
| `uuid` | 36자 문자열 | **Wings WebSocket** URL(`/api/servers/{uuid}/ws`); Client 경로도 허용 |

- `lib/ptero/types.ts`에서 **branded type**으로 분리한다(아래). 함수 시그니처가 잘못된 식별자를 받으면 **컴파일 에러**.

```ts
type Brand<T, B> = T & { readonly __brand: B };
export type ServerNumericId = Brand<number, 'ServerNumericId'>;
export type ServerIdentifier = Brand<string, 'ServerIdentifier'>; // 8 chars
export type ServerUuid       = Brand<string, 'ServerUuid'>;       // 36 chars
```

### 4.6 서브유저 한계 (문서화된 제약)
- "유저 X가 *서브유저*인 서버" 목록을 주는 **Application API가 없다**(부록 A §6-B). 유일한 방법은 전 서버를 돌며 `GET /api/client/servers/{id}/users`를 확인하는 **O(서버수) 스캔**.
- 따라서 **MVP는 소유 서버만 스코프**. Phase 4(서브유저)에서 **백그라운드 동기화로 `ServerAccess` 캐시 테이블**을 채워 해결한다(스캔을 요청 경로 밖으로 빼서 레이트리밋 보호).

---

## 5. 컴포넌트(모듈) 구조

```
pteron-panel/
├─ docker-compose.yml            # app + postgres (+ migrate)
├─ Dockerfile                    # Next standalone
├─ .env.example                  # 시크릿/설정 템플릿
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts                    # 초기 관리자 시드
├─ src/
│  ├─ app/                       # App Router (UI + 최소 API)
│  │  ├─ (auth)/login/           #   로그인 화면 + action
│  │  ├─ (panel)/                #   인증 필요 레이아웃(앱 셸)
│  │  │  ├─ servers/page.tsx     #     내 서버 목록
│  │  │  └─ servers/[id]/        #     서버 상세 (탭 레지스트리)
│  │  │     ├─ layout.tsx        #       헤더 + 탭
│  │  │     ├─ page.tsx          #       개요
│  │  │     └─ console/page.tsx  #       콘솔
│  │  └─ api/ws-token/route.ts   #   (선택) 콘솔 토큰 Route Handler
│  ├─ lib/
│  │  ├─ config.ts               #   env 검증(zod) — 유일하게 process.env 읽음
│  │  ├─ db.ts                   #   Prisma 싱글턴
│  │  ├─ ptero/                  #   ★ Pterodactyl API 클라이언트 레이어
│  │  │  ├─ http.ts              #     공통 fetch·에러 정규화·429·타임아웃
│  │  │  ├─ application.ts       #     Application API 래퍼
│  │  │  ├─ client.ts            #     Client API 래퍼
│  │  │  ├─ errors.ts            #     PteroApiError 등
│  │  │  └─ types.ts             #     branded 식별자 + 응답 타입
│  │  ├─ auth/                   #   세션 발급/검증·argon2·requireUser()
│  │  └─ authz/                  #   ★ 인가·스코프 (access.ts, guard.ts, cache.ts)
│  ├─ server/                    # Server Actions (유일한 변경 경로)
│  │  ├─ auth.ts                 #   login/logout
│  │  └─ servers.ts              #   listMyServers/getOverview/power/getConsoleCredentials
│  ├─ features/                  # 기능별 UI (server-list, server-overview, console)
│  │  └─ console/socket.ts       #   WS 매니저(auth·재연결·토큰갱신)
│  ├─ components/                # 공용 디자인 시스템(shadcn/ui 기반)
│  ├─ registry/                  # ★ 서버 뷰 탭 레지스트리 (플러그인 seam)
│  └─ test/                      # Vitest 단위·통합 + Playwright e2e
└─ ...
```

**경계 원칙**
1. UI는 **절대** `lib/ptero`를 직접 import하지 않는다 → 반드시 `server/*` 경유 → 키·인가가 항상 적용.
2. `lib/ptero`는 **인가를 모른다**(순수 API). 인가는 `lib/authz`가 전담.
3. `lib/config.ts`만 `process.env`를 읽는다 → 설정 누락을 부팅 시 zod로 즉시 실패.
4. `registry/`(탭 레지스트리)와 `server/*`의 타입드 경계는 **플러그인 SDK의 미래 기반**(§17).

---

## 6. 데이터 모델 (Prisma / PostgreSQL)

```prisma
enum Role { ADMIN  USER }

model User {
  id           String   @id @default(cuid())
  email        String   @unique            // Pterodactyl 유저 매칭용
  username     String   @unique
  passwordHash String                       // argon2id
  role         Role     @default(USER)
  // Pterodactyl 매핑
  pteroUserId  Int?     @unique             // Application API 숫자 id
  pteroUuid    String?  @unique
  isActive     Boolean  @default(true)      // false면 로그인·세션 즉시 차단
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sessions     Session[]
  auditLogs    AuditLog[]
}

model Session {
  id         String   @id @default(cuid())
  tokenHash  String   @unique               // 쿠키 토큰의 SHA-256 (원문 미저장)
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  ip         String?
  userAgent  String?
  @@index([userId])
}

model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  action    String                          // "auth.login", "server.power" …
  target    String?                         // 서버 identifier 등
  metadata  Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}
```

- **접근 가능 서버 목록은 DB에 저장하지 않는다**(런타임 해석 + 캐시, §4). Pterodactyl을 단일 진실 공급원으로 유지 → 동기화 버그 회피.
- 마이그레이션은 **가산적**으로만(Prisma migrate). Phase 4의 `ServerAccess`, Phase 6의 `Plugin`/`PluginInstallation`을 나중에 무리 없이 추가.

---

## 7. 설정·시크릿 (zod 검증) — `lib/config.ts`

| 변수 | 필수 | 용도 |
|---|---|---|
| `PANEL_URL` | ✅ | Pterodactyl Panel 베이스 URL (예: `https://panel.example.com`) |
| `PTERO_APP_KEY` | ✅ | **Application API 키**(`ptla_…`) |
| `PTERO_CLIENT_KEY` | ✅ | **Client API 키**(`ptlc_…`, **root-admin 유저** 소유) |
| `DATABASE_URL` | ✅ | PostgreSQL 접속 |
| `SESSION_SECRET` | ✅ | 세션 토큰/쿠키 서명·해시 솔트 |
| `APP_BASE_URL` | ✅ | Pteron 공개 URL (쿠키 도메인·콘솔 Origin 안내) |
| `SESSION_TTL_HOURS` | ⬜(기본 12) | 세션 만료 |
| `LOG_LEVEL` | ⬜ | 로깅 |

> 부팅 시 zod 파싱 실패 → 프로세스 즉시 종료(설정 실수 조기 발견). `PTERO_CLIENT_KEY`가 **root-admin 유저의 키**여야 한다는 점을 `.env.example` 주석과 README에 강조.

---

## 8. 인증·세션·온보딩

### 8.1 세션 (D6 — 명시적 DB 세션)
- 로그인: `username/email + password` → argon2id 검증 → **32바이트 랜덤 토큰** 생성 → **SHA-256 해시만 DB(`Session.tokenHash`) 저장**, 원문은 **httpOnly·Secure·SameSite=Lax 쿠키**로만 전달.
- 검증: `lib/auth/requireUser()`가 쿠키 토큰 → 해시 조회 → `expiresAt`·`user.isActive` 확인 → `User` 반환. 레이아웃/액션에서 호출.
- 미들웨어(`middleware.ts`)는 **쿠키 존재 여부만** 보고 비로그인 시 `/login` 리다이렉트(Edge 런타임, DB 미접근). **권위 검증은 서버측 `requireUser()`** 가 담당(Node 런타임).
- 취소: `Session` 행 삭제(개별/전체 로그아웃) 또는 `user.isActive=false` → 즉시 차단.
- 슬라이딩 만료: `lastSeenAt` 갱신, `expiresAt` 연장(옵션).
- CSRF: Server Actions는 동일 출처 강제 + SameSite=Lax 쿠키로 1차 방어. 민감 mutation은 추가로 Origin 확인.

> **대안 검토:** Auth.js v5 Credentials는 **DB 세션을 지원하지 않고 JWT 세션을 강제**(즉시 취소 어려움)하므로 보안 민감한 멀티테넌트 패널에는 부적합 → **명시적 DB 세션 채택**. (Lucia는 deprecate.) 비밀번호 해시·랜덤 토큰은 `@node-rs/argon2` + `crypto`로 처리.

### 8.2 역할 & 온보딩(MVP 최소)
- 역할: `ADMIN`(전체 + 관리자 영역) / `USER`(매핑된 소유 서버).
- **MVP 온보딩 = 시드 기반**: `prisma/seed.ts`가 env로 **초기 ADMIN 1명**과 **매핑된 테스트 USER 1명 이상**(`SEED_ADMIN_*`, `SEED_USER_*`)을 생성한다. 이것만으로 §18 스코프 격리 검증이 가능하다.
- **매핑 메커니즘(지금 정의, Phase 3 재사용)**: Pteron 계정에 Pterodactyl 유저를 연결할 때 Application API 유저 검색(이메일)으로 `pteroUserId`/`pteroUuid`를 채운다. 시드는 이 메커니즘을 그대로 사용한다.
- **풀 유저관리 UI(계정 생성·검색·매핑·편집)는 Phase 3.** MVP엔 별도 관리 UI를 만들지 않는다.

---

## 9. Pterodactyl API 클라이언트 레이어 (`lib/ptero`)

### 9.1 `http.ts` (공통)
- `pteroFetch(api, path, init)`:
  - 베이스: `${PANEL_URL}/api/{application|client}`, 헤더 `Authorization: Bearer <key>`, `Accept: application/json`, (바디 시) `Content-Type: application/json`.
  - **에러 정규화**: 비2xx → 응답 envelope `{errors:[{code,status,detail,source}]}`를 파싱해 `PteroApiError(status, code, detail, field?)`로 throw.
  - **429**: `Retry-After` 존중 백오프(짧은 재시도 1–2회). `X-RateLimit-Remaining` 로깅.
  - **타임아웃**: AbortController(기본 15s).
  - **재시도**: idempotent GET만(네트워크/5xx 한정).
- 모든 응답은 **타입드 파서**(zod 또는 명시 매퍼)로 envelope(`{object,attributes}` / `{object:'list',data,meta.pagination}`) 해제.

### 9.2 `application.ts` (관리자, 숫자 id)
- `getUser(id, {include})`, `listUsers({filter})`, `listServers({include,filter,page})`, `getServer(id)`, (Phase 3+: createServer/updateBuild/… nodes/locations/nests/eggs).
- **페이지네이션 헬퍼** `paginateAll(fetchPage)` → `meta.pagination.total_pages` 순회(부록 A §6-A).

### 9.3 `client.ts` (런타임, identifier/uuid)
- `listServers({type})` — `type: 'admin-all' | 'owner' | undefined`.
- `getServer(identifier)`, `getResources(identifier)`(폴링 지양·디버그용), `power(identifier, signal)`, `command(identifier, cmd)`, **`getWebsocketCredentials(identifier)` → `{token, socket}`**.
- (Phase 2+: files*, backups*, databases*, …)

### 9.4 에러 처리 매핑(UX)
| 상태 | 의미 | UX |
|---|---|---|
| 401/403 | 키 문제 | 운영자 알림(유저에겐 일반 오류). 감사로그. |
| 404 | 없음/접근불가 | "서버를 찾을 수 없음" |
| 409 | 상태 충돌(suspended/installing) | "현재 작업할 수 없는 상태" + 사유 |
| 413 | 업로드 초과(Phase 2) | 크기 안내 |
| 422 | 검증 실패 | `source.field`로 폼 인라인 에러 |
| 429 | 레이트리밋 | 자동 백오프 후 "잠시 후 재시도" |
| 5xx | 패널/노드 오류 | "일시적 오류" + request id |

---

## 10. Phase 1 기능 상세

### 10.1 서버 목록 — `server/servers.ts: listMyServers()`
1. `requireUser()` → 세션 유저.
2. `resolveAccessibleServers(user)`(캐시) → 카드 목록(이름·노드·식별자). 상태/통계는 목록에선 **표시하지 않거나** 마지막 알려진 값(가벼움). 라이브는 상세에서.
3. UI: 카드 그리드 + 검색.

### 10.2 서버 개요 — `getServerOverview(identifier)`
1. `requireUser()` → `requireServerAccess(user, identifier)`.
2. `client.getServer(identifier)` → 이름·상태·노드·할당·리소스 제한·feature_limits.
3. 전원 버튼(아래). **라이브 통계는 콘솔 탭**(상시 WS 회피로 버킷 절약); 개요엔 "콘솔 열기" CTA + 수동 새로고침(단발 `getResources`).

### 10.3 전원 — `powerServer(identifier, signal)`
- 가드 후 `client.power(identifier, signal)`(`signal: start|stop|restart|kill`, 부록 A §3.1) → 202/204. 감사로그.
- 콘솔 탭이 열려 있으면 UI는 WS `set state`를 우선 사용(버킷 0).

### 10.4 콘솔 (핵심) — WebSocket 시퀀스

```
브라우저                         Next 서버                    Wings(노드)
  │  getConsoleCredentials(id) ──▶ requireServerAccess
  │                                client.getWebsocketCredentials
  │  ◀── { token, socket } ────────  (키 노출 X)
  │
  │  WS connect(socket) ───────────────────────────────────▶ (Origin 검사)
  │  {"event":"auth","args":[token]} ─────────────────────▶ JWT 검증
  │  ◀───────────── {"event":"auth success"} ──────────────
  │  ◀───── status / stats / console output (스트림) ───────
  │  {"event":"send command","args":["say hi"]} ──────────▶
  │  {"event":"set state","args":["restart"]} ────────────▶
  │  ◀───────────── {"event":"token expiring"} ─────────────  (≤60초)
  │  getConsoleCredentials(id) ──▶ … 재발급
  │  {"event":"auth","args":[newToken]} ──────────────────▶  (동일 소켓)
```

- **WS 매니저(`features/console/socket.ts`)**: 연결·`auth`·이벤트 디스패치·**토큰 갱신**(`token expiring` 또는 ≈8분 주기 선제 재발급, 동일 소켓에 새 `auth`)·**지수 백오프 재연결**·정지 서버 종료코드 **4409** 처리.
- 렌더링: **xterm.js** 터미널(`console output`), 통계 위젯(`stats`: CPU/RAM/디스크/네트워크/업타임), 명령 입력창, 전원 버튼.
- 권한: 토큰 JWT가 admin이면 install/transfer/error 출력까지 수신(부록 A §4).

### 10.5 ⚠️ 배포 전제 (콘솔 필수)
브라우저가 Wings에 직접 붙으므로, **콘솔을 쓸 모든 노드**의 `/etc/pterodactyl/config.yml`에 Pteron Origin을 추가해야 한다(정확히 scheme+host+port, 부록 A §5):
```yaml
allowed_origins:
  - 'https://pteron.example.com'
```
설정 후 Wings 재시작. 이 요구사항을 README·설치 가이드·온보딩 체크리스트에 명시.

---

## 11. UI/UX

- **앱 셸**: 좌측 내비(서버 / 관리자[admin만] / 계정) + 상단 바(유저·테마 토글·로그아웃). 반응형.
- **서버 목록**: 카드 그리드, 상태 배지, 검색/필터.
- **서버 뷰**: 헤더(이름·상태·전원 버튼) + **탭 레지스트리**(`registry/server-tabs.ts`의 배열로 렌더 → 개요·콘솔, 향후 플러그인 탭). 콘솔 탭은 xterm.js + 통계 위젯.
- **디자인 시스템**: Tailwind + **shadcn/ui**(Radix 기반, 접근성·복붙형 → 바이브 코딩·유지보수 친화). 다크/라이트.
- **i18n**: `next-intl` 등으로 **자리만**(한/영 키), 실제 번역은 Phase 5.
- 상태 표시: 토스트(성공/오류), 로딩 스켈레톤, 낙관적 전원 버튼.

---

## 12. 에러 처리 전략

- **단일 정규화 지점**: 모든 Panel 오류는 `lib/ptero/http.ts`에서 `PteroApiError`로 변환(§9.1) → Server Action이 잡아 **사용자 친화 결과**(또는 `useActionState` 에러)로 매핑.
- **silent failure 금지**: catch는 항상 (a) 사용자에게 표면화 + (b) 서버 로그/감사로그 기록. 빈 catch·무의미 fallback 금지.
- **request id 전파**: 패널/Wings의 `X-Request-Id`를 로그에 남겨 추적.
- **상태 충돌(409)·설치중**: 명확한 사유 메시지. 콘솔은 4409(정지) UI 처리.

---

## 13. 테스트 전략

| 레벨 | 도구 | 범위 |
|---|---|---|
| 단위 | **Vitest** | `authz`(소유/admin/거부 스코프), 에러 정규화, branded 식별자 매핑, `config` zod, 세션 발급/검증 |
| 통합 | Vitest + **MSW** | `lib/ptero` ↔ 모킹된 Panel API: envelope 파싱, **페이지네이션**, **429 백오프**, 에러 매핑 |
| WS | 모킹 WS 서버 | 콘솔 매니저: auth·토큰 갱신·재연결·4409 |
| e2e | **Playwright** | 로그인 → 목록 → 콘솔 열기 → 명령 전송. **시드 유저(ADMIN/USER)로 스코프 격리** 검증(USER가 타 서버 접근 시 404) |

- TDD 권장(테스트 먼저 → 구현). CI에서 lint+typecheck+unit+integration 게이트.

---

## 14. 배포 (Docker Compose)

```yaml
services:
  app:       # Next.js standalone, :3000, .env로 두 키·DB·시크릿 주입
  db:        # postgres:16, 영속 볼륨
  migrate:   # prisma migrate deploy → app 시작 전 1회
```
- `Dockerfile`: Next `output: 'standalone'` 멀티스테이지(작은 이미지).
- 리버스 프록시(예: Caddy/Nginx)로 TLS 종단 → `APP_BASE_URL` 일치.
- **운영 체크리스트**: ① 두 키 발급(Application은 필요한 read/write ACL, Client는 root-admin 유저) ② 각 노드 Wings `allowed_origins`에 Pteron Origin ③ 키 IP allowlist 설정 시 app egress IP 허용(부록 A §7).

---

## 15. 보안 고려사항

- **키 격리**: 두 키는 서버 전용. 로그·에러·클라이언트 응답에 **절대 노출 금지**(마스킹).
- **권위 인가**: 모든 서버 스코프 경로에서 `requireServerAccess`. 클라이언트가 보낸 식별자를 신뢰하지 않음.
- **세션**: httpOnly·Secure·SameSite, 토큰 해시 저장, 즉시 취소(`isActive`/세션 삭제), 슬라이딩 만료.
- **감사로그**: 로그인·전원·(후속)파일/백업/관리자 액션 기록.
- **레이트리밋**: §4.4. 추가로 Pteron 자체 로그인 시도 제한(브루트포스 방지).
- **플러그인(미래)**: §17 — 사용자 코드가 **키·세션·타 테넌트 데이터에 접근 불가**하도록 격리(최우선 설계 과제).
- **입력 검증**: 모든 액션 입력 zod 검증.

---

## 16. 로드맵 (포괄 계획)

> 각 Phase는 **자체 spec → 계획 → 구현** 사이클. 첫 슬라이스(0+1)만 본 문서에서 상세 설계.

| Phase | 영역 | 핵심 기능 | 의존 |
|---|---|---|---|
| **0. 기반** | 공통 | 앱 스켈레톤·Docker, 타입드 Panel 클라이언트, Prisma, **세션 인증**, **인가·스코프 코어**, 앱 셸/디자인 시스템, **탭 레지스트리 seam** | — |
| **1. 클라이언트 수직 슬라이스(MVP)** | Client | 스코프된 **서버 목록** → **개요/전원** → **콘솔(Wings WS 직접)** | 0 |
| **2. 핵심 클라이언트** | Client | **파일 매니저**(편집/업·다운로드/이동·복사/압축/권한/원격풀), **백업**(생성/복원/다운로드/잠금) | 1 |
| **3. 관리자 코어** | Admin | **유저 관리**(+매핑/온보딩 UI), **서버 생성 마법사**(노드·Egg·할당·리소스·환경변수)+수정/정지/삭제, **노드 관리**, 로케이션 | 0 |
| **4. 나머지 클라이언트 + 서브유저** | Client | DB·스케줄·네트워크/할당·Startup/변수·**서브유저**(+`ServerAccess` 캐시로 스코프 확장)·설정(rename/reinstall/이미지)·활동로그 | 1 |
| **5. 마감·강화** | 공통 | 모니터링 대시보드, 알림, **i18n(한/영)**, 테마, 레이트리밋·에러 강화, 배포 하드닝 | 1–4 |
| **6. 플러그인 시스템** | 공통 | §17 — 공식 사용자 플러그인(매니페스트·SDK·확장지점·라이프사이클·**샌드박싱**·레지스트리) | 0(seam), 1–5 |

---

## 17. 플러그인 시스템 (후속 — 계획만)

> 요청: "이 패널은 공식적으로 사용자 플러그인을 지원한다. 사용자가 직접 만들고 적용할 수 있어야 한다." → **Phase 6에서 상세 spec.** 지금은 범위·보안·기반 seam만 확정.

### 17.1 범위(후속 spec 대상)
- **매니페스트**: `plugin.json`(이름·버전·권한·확장지점·진입점).
- **확장 지점**: 서버 뷰 **탭**, 대시보드 **위젯**, **이벤트 훅**(server start/backup 등), **커스텀 액션**.
- **라이프사이클**: 업로드/설치 → 활성/비활성 → 버전·업데이트 → 삭제. DB: `Plugin`, `PluginInstallation`.
- **레지스트리/마켓플레이스**(선택): 공유·검색.

### 17.2 🔒 보안 (최우선 설계 과제)
- 사용자 플러그인 = **임의 코드**. **두 마스터 키·세션·타 테넌트 데이터에 절대 접근 불가**해야 함(키 탈취 = 전체 장악).
- 후보: **서버측 격리 실행**(별도 프로세스/워커, 제한된 SDK만 노출, 네트워크·FS 차단), **UI는 iframe 샌드박스**(postMessage로 제한 통신), 권한 명세 기반 capability 모델.
- 플러그인은 **Panel SDK(제한 API)** 를 통해서만 데이터에 접근 → 모든 호출이 인가·스코프를 통과.

### 17.3 지금 심는 저비용 seam (Phase 0)
- **탭 레지스트리**(`registry/server-tabs.ts`): 서버 뷰 탭을 배열로 → 후일 플러그인이 탭 등록.
- **안정적 내부 경계**: `server/*` Server Actions + `lib/ptero` 타입 → 미래 Panel SDK의 기반.
- **가산적 마이그레이션**: `Plugin`/`PluginInstallation`을 나중에 추가해도 무리 없음.
- **보안 원칙 명문화**(§15): 키 격리·권위 인가를 처음부터 불변식으로.

---

## 18. 첫 슬라이스 완료 기준 (Definition of Done)

- [ ] `docker compose up`으로 app+db+migrate 기동, zod 설정 검증 통과.
- [ ] 시드 ADMIN 로그인 → 세션 쿠키 발급/검증/로그아웃·취소 동작.
- [ ] **USER 로그인 → 자기 소유 서버만** 목록에 표시. 타 서버 직접 접근 시 **404**.
- [ ] ADMIN 로그인 → `admin-all`로 전체 서버 표시.
- [ ] 서버 개요(이름·상태·제한) 표시, 전원 start/stop/restart/kill 동작.
- [ ] **콘솔**: WS 연결·auth·실시간 출력/통계·명령 전송·전원 변경·**토큰 자동 갱신**·재연결·4409 처리.
- [ ] 두 키가 브라우저 응답·로그 어디에도 노출되지 않음(검증).
- [ ] 레이트리밋 429 백오프 동작. 라이브 데이터는 WS 경유(REST 폴링 없음).
- [ ] 테스트(단위·통합·e2e) 통과, lint·typecheck 그린.
- [ ] README: 두 키 발급·**Wings `allowed_origins`**·배포 절차 문서화.

---

## 19. 리스크 / 오픈 이슈 / 버전 노트

- **R1 레이트리밋 공유 버킷**(§4.4): 단일 Client 키 720/분 공유. 완화책 채택(WS 우선·캐시). 대규모 동시성에서 재평가.
- **R2 서브유저 스코프**(§4.6): MVP 제외, Phase 4에서 캐시 테이블로 해결.
- **R3 Wings Origin 설정**(§10.5): 노드별 수동 설정 필요(운영 의존). 문서·체크리스트로 완화.
- **R4 노드 TLS**: 콘솔 WS는 노드 FQDN:8080(wss). 노드에 유효 인증서 전제. 자가서명 시 브라우저 차단 → 문서화.
- **R5 인증 구현**: 명시적 DB 세션 채택(D6). 직접 구현 코드의 보안은 테스트·리뷰로 보강.
- **버전**: 본 spec은 **Panel 1.11.x** 기준(부록 A 소스 검증). 1.12/develop는 경로 표면 동일하나 throttle 메커니즘 차이 → 타겟 변경 시 재검증.
- **불확실(부록 A 플래그)**: user-create `password` 선택성, `/nodes/deployable` GET+body, `filter[owner]` 부재, Wings "token expiring" 실제 ≤60초(주석은 3분) → 코드 기준으로 구현.

---

## 부록 A. 검증된 Pterodactyl Panel API 레퍼런스 (v1.11.x)

> Panel `v1.11.11` / Wings `v1.11.13` 소스 코드 직접 검증. 본 슬라이스가 의존하는 부분 위주 발췌(전체 표면은 후속 Phase에서 확장).

### A.1 인증·공통
- 헤더(둘 다): `Authorization: Bearer <key>`, `Accept: application/json`, (바디) `Content-Type: application/json`.
- 베이스: Application `/api/application`(키 `ptla_…`, 숫자 `id` 바인딩), Client `/api/client`(키 `ptlc_…`, 특정 유저 소유).
- **레이트리밋**: Client **720/분**, Application **240/분**, **유저 UUID당**(IP로 회피 불가). `X-RateLimit-*` 헤더, 429 시 `Retry-After`. `POST …/files/pull`은 추가 10/5분.
- **에러 envelope**: `{"errors":[{"code","status","detail","source":{"field"},"meta"}]}`. 접근불가 서버는 **404**(존재 은닉).
- **성공 envelope**: 단건 `{object,attributes,relationships?}`; 목록 `{object:"list",data:[…],meta:{pagination:{total,count,per_page,current_page,total_pages,links}}}`.

### A.2 Linchpin (검증)
- **`AuthenticateServerAccess`**: `if (user.id !== server.owner_id && !user.root_admin) { …subuser 확인… else 404 }` → **root_admin은 owner/subuser 검사 우회 → 임의 서버 client 엔드포인트 접근 가능.** (v1.11/develop 동일.)
- **`GET /api/client?type=`**: `admin-all`(root_admin) → **전 서버**; `owner` → 소유; 기본 → 소유+서브유저; 비admin이 admin/admin-all → 빈 집합. 페이지: 기본 50, 최대 100.
- **suspended/installing 서버**: admin도 power/command/files는 **409**; 단 `view`·`resources`·**websocket**(로그용)은 허용.

### A.3 본 슬라이스가 쓰는 엔드포인트
| API | Method | Path | 용도 |
|---|---|---|---|
| App | GET | `/users/{id}?include=servers` | 유저 **소유 서버** 열거(스코프) |
| App | GET | `/servers?include=…&page=N` | (보조) 서버 목록·페이지네이션 |
| Client | GET | `/?type=admin-all\|owner` | 접근 가능 서버 목록 |
| Client | GET | `/servers/{id}` | 서버 상세(identifier/internal_id/uuid/limits) |
| Client | GET | `/servers/{id}/resources` | (지양) 단발 라이브 사용량 |
| Client | POST | `/servers/{id}/power` | `{ "signal":"start\|stop\|restart\|kill" }` |
| Client | POST | `/servers/{id}/command` | `{ "command":"…" }`(오프라인 시 502) |
| Client | GET | `/servers/{id}/websocket` | **`{ data:{ token, socket } }`** |

- `/resources` 응답: `{object:"stats",attributes:{current_state,is_suspended,resources:{memory_bytes,cpu_absolute,disk_bytes,network_rx_bytes,network_tx_bytes,uptime}}}`.
- `/websocket`의 `socket` = `wss://<node>:8080/api/servers/<uuid>/ws`(36자 uuid). 토큰 HS256, **10분**, JTI=`md5(user.id+server.uuid)`.

### A.4 콘솔 WS 이벤트 (정확한 문자열)
- **inbound**(브라우저→Wings): `auth`, `set state`(`start|stop|restart|kill`), `send command`, `send stats`, `send logs`.
- **outbound**(Wings→브라우저): `auth success`, `token expiring`(≤60초), `token expired`, `daemon error`, `jwt error`, `status`, `stats`, `console output`, `install output/started/completed`, `daemon message`, `backup completed`, `backup restore completed`, `transfer logs/status`.
- 토큰 갱신: `token expiring` 또는 선제(≈8분) 시 `GET …/websocket` 재호출 → **동일 소켓**에 새 `auth`. 완전 만료 후 비-auth 메시지는 `jwt error`.
- 권한: JWT `permissions[]`. `"*"`는 비-admin 권한만, `admin.*`(install/transfer/error 출력)는 명시 필요 — root-admin 토큰엔 포함.

### A.5 Wings Origin 검사 (콘솔 CORS)
- `CheckOrigin`: `Origin == remote(공식 패널 URL)` 또는 `allowed_origins`에 정확히 일치(또는 `*`)해야 통과. **커스텀 패널은 각 노드 `config.yml`의 `allowed_origins`에 자기 Origin 추가 필수**(scheme+host+port 정확히). 재시작 필요.

### A.6 스코프 열거 (검증)
- **소유**: `GET /api/application/users/{id}?include=servers` = `owner_id` 기준. (또는 `/servers` 전체 페이지네이션 후 `attributes.user` 필터; v1.11엔 `filter[owner]` 없음.)
- **서브유저**: Application API **없음** → 전 서버 `GET /api/client/servers/{id}/users` 스캔(O(서버수)). → MVP 제외, Phase 4 캐시.
- **식별자**: Application=숫자 `id` / Client=8자 `identifier`(또는 36자 uuid; `strlen===8?uuidShort:uuid`) / WS=36자 `uuid`.

### A.7 (후속 Phase 참고) 생성 바디 요약
- **User 생성**: `{email, username, first_name, last_name, password?(선택), root_admin?, external_id?, language?}`.
- **Server 생성**: `{name, user, egg, docker_image, startup, environment{}, limits{memory,swap,disk,io,cpu,threads?}, feature_limits{databases,allocations,backups}, (allocation{default,additional[]} XOR deploy{locations[],dedicated_ip,port_range[]}), start_on_completion?}`.

---

*(끝 — 본 문서는 Phase 0+1 상세 설계 + 전체 로드맵을 담는다. 후속 Phase는 각자 spec을 추가한다.)*
