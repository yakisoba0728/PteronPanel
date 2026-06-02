# Pteron Panel — 플러그인 시스템 설계 문서 (Phase 6 Design Spec)

| 항목 | 값 |
|---|---|
| 날짜 | 2026-06-02 |
| 상태 | **Draft (검토 대기)** |
| 대상 | Pteron Panel (Phase 0–5 완성 기반 위) |
| 모델 | **외부 통합(webhook) 플러그인** — GitHub App / Slack App 방식 |
| 참조 | 메인 spec §17(플러그인 seam·보안 원칙), §4(인가·스코프), §15(보안) |

---

## 0. 요약 (TL;DR)

Pteron Panel의 **공식 사용자 플러그인 시스템**. 핵심 제약은 "**사용자가 직접 플러그인을 만들고 적용**"(= 신뢰할 수 없는 사용자 코드)인데, 패널은 **두 마스터 키**를 보유한 멀티테넌트 시스템이다. 그래서 **임의 코드를 패널 안에서 실행하지 않는** 외부 통합 모델을 채택한다:

- 플러그인 = 사용자가 **자기 인프라에 호스팅**하는 외부 서비스.
- 패널은 (1) **소유자 스코프 API 토큰**(`ptex_…`) 발급, (2) **서명된 이벤트 webhook** 전송, (3) 플러그인 UI를 **샌드박스 iframe**으로 임베드.
- 플러그인의 모든 권한 = **등록한 사용자(소유자)의 멀티테넌트 스코프**로 제한. 마스터 키·세션·타 테넌트 데이터에 절대 접근 불가.
- 이벤트는 **패널 발생 동작**(액션 레이어 훅)에서만 발행.

규모가 커서 **3개 하위 계획(6a/6b/6c)** 으로 구현 분해한다(§13).

---

## 1. 목표 / 비목표

### 목표
- 사용자가 외부 서비스를 **플러그인으로 등록**하고, 자기 스코프 내에서 패널을 확장(UI 탭/위젯 + 백엔드 자동화 + 패널 API 호출).
- 패널이 **임의 코드를 실행하지 않고도** "풀 확장"(UI + 백엔드 + 커스텀 API)을 제공.
- 기존 인가·스코프·권한 레이어를 **그대로 재사용**해 플러그인이 소유자 권한을 절대 못 넘게 강제.

### 비목표
- 패널 내부에서 사용자 코드 실행(인-패널 샌드박스·컨테이너) — 명시적으로 채택 안 함.
- 플러그인 마켓플레이스/스토어(공개 배포·검색) — 후속(MVP는 개인 등록).
- Wings발 상태 이벤트(서버 크래시 등) 구독 — 후속(MVP는 패널 발생 이벤트만).
- 관리자 전역 플러그인 — 후속(MVP는 사용자별·소유자 스코프).
- 플러그인 간 통신, 결제, 버전 호환 매트릭스.

---

## 2. 핵심 결정 (확정)

| # | 결정 | 값 |
|---|---|---|
| P1 | 확장 범위 | **풀 확장**(UI + 백엔드 + 커스텀 API) |
| P2 | 실행 모델 | **외부 통합(webhook)** — 코드는 사용자 인프라, 패널 미실행 |
| P3 | 토큰 스코프 / 등록 | **사용자별 플러그인 + 소유자 스코프 토큰** |
| P4 | 이벤트 소스 | **패널 발생 이벤트**(액션 레이어 훅) |
| P5 | UI | **샌드박스 iframe** 임베드 + postMessage 단기 컨텍스트 토큰 |
| P6 | 분해 | **6a 등록·토큰·스코프 API / 6b 이벤트 webhook / 6c UI iframe** |

---

## 3. 아키텍처 & 모델

**3 액터:**
- **플러그인 서비스** — 사용자가 자기 인프라에 호스팅(임의 언어/코드). 패널 안에서 실행 안 됨.
- **Pteron 패널** — 등록 관리, `ptex_` 토큰 발급, 이벤트 webhook 전송, 플러그인 UI iframe 임베드.
- **플러그인 소유자** — 등록한 사용자. 플러그인 권한 = 소유자의 멀티테넌트 스코프.

```
[플러그인 서비스 (사용자 호스팅)]
   ▲  │ (1) 스코프 API:  /api/ext/*  (Bearer ptex_토큰)
   │  ▼     → tokenHash→소유자 해석 → requireServerAccess/Permission(소유자) → lib/ptero 대행
[Pteron 패널] ──(2) 이벤트 webhook (HMAC 서명 + timestamp, 소유자 스코프 필터)──▶ [플러그인 webhook URL]
   │
   └──(3) 서버 뷰 탭/위젯 = <iframe sandbox src=플러그인UI>
            iframe ← postMessage(단기 컨텍스트 토큰) → /api/ext/* (소유자 스코프)
```

**불변식:**
- 패널은 임의 코드를 실행하지 않는다(외부 서비스가 실행) → 샌드박스 탈출·CPU 남용 리스크 제거.
- `ptex_` 토큰은 마스터 키가 아니다 — 패널이 토큰→소유자 매핑 후 **기존 인가 레이어를 소유자 신원으로** 통과시켜 대행. 마스터 키는 서버 전용·비노출 유지.
- 모든 플러그인 API 호출·이벤트는 **소유자 스코프**로 필터.
- 이벤트는 패널 발생 동작에서만.

---

## 4. 데이터 모델 (Prisma, 가산 마이그레이션)

```prisma
model Plugin {
  id               String   @id @default(cuid())
  ownerId          String
  owner            User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name             String
  description      String?
  tokenHash        String   @unique          // HMAC-SHA256(SESSION_SECRET, ptex_token); 원문은 생성 시 1회만 표시
  webhookUrl       String?                   // 이벤트 전송 대상(선택)
  webhookSecretEnc String?                   // HMAC 서명 시크릿(앱키 암호화 저장; 서명에 복호 필요)
  events           String[] @default([])     // 구독 이벤트 타입
  uiTabUrl         String?                   // 서버 뷰 탭 iframe URL(선택)
  uiTabLabel       String?
  enabled          Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  deliveries       WebhookDelivery[]
  @@index([ownerId])
}

model WebhookDelivery {
  id           String   @id @default(cuid())
  pluginId     String
  plugin       Plugin   @relation(fields: [pluginId], references: [id], onDelete: Cascade)
  event        String
  status       String   // pending | success | failed
  attempts     Int      @default(0)
  responseCode Int?
  error        String?
  createdAt    DateTime @default(now())
  @@index([pluginId, createdAt])
}
```
- `tokenHash`: 세션과 동일 방식(원문 1회 노출, HMAC 해시 저장).
- `webhookSecretEnc`: 서명에 원문이 필요하므로 **`SESSION_SECRET`에서 HKDF로 파생한 앱 키로 AES-GCM 암호화 저장**(평문 저장 금지, 별도 env 불필요). `lib/crypto`에 `encryptSecret`/`decryptSecret` 추가.

---

## 5. 등록 & 라이프사이클

- **계정 영역 신규 페이지** `(panel)/account/plugins` — 누구나 자기 플러그인 관리.
- **등록**: name·description·webhookUrl(선택)·uiTabUrl+label(선택)·구독 이벤트 선택 → 서버 액션이 `Plugin` 생성, **`ptex_` 토큰 + webhook 시크릿 생성 → 각 1회만 표시**(토큰 해시·시크릿 암호화 저장).
- **활성/비활성 토글**(`enabled`) — 비활성 시 토큰 즉시 무효 + 이벤트 중단.
- **토큰/시크릿 회전** — 새 값 생성·재표시, 기존 무효.
- **삭제** — 캐스케이드(전송 로그 포함).
- 스코프 선택 없음(MVP): 토큰 = **소유자 전체 스코프**, 호출 시점에 라이브 해석(`resolveAccessibleServers(owner)`).
- 모든 라이프사이클 액션 `requireUser` + 소유권 확인(본인 플러그인만) + 감사 로그.

---

## 6. 스코프 API `/api/ext/*` (플러그인용)

- **인증 미들웨어/헬퍼**: `Authorization: Bearer ptex_…` → `tokenHash` 조회 → `enabled` 확인 → 소유자 `User` 해석. 실패 시 401.
- **핸들러는 기존 인가·ptero 레이어를 소유자 신원으로 재사용**: `requireServerAccess(ownerScope, id)` / `requireServerPermission(...)` → `lib/ptero/client|application`. 세션 대신 플러그인-소유자.
- **MVP 노출 표면**(전부 소유자 스코프, Route Handler `src/app/api/ext/.../route.ts`):
  - `GET /api/ext/servers` — 접근 가능 서버 목록
  - `GET /api/ext/servers/{id}` · `/resources`
  - `POST /api/ext/servers/{id}/power` `{signal}` · `/command` `{command}`
  - `GET /api/ext/servers/{id}/files/list|contents` · `POST .../files/write`
  - `GET /api/ext/servers/{id}/backups` · `POST .../backups` · `GET .../backups/{uuid}/download`
- **레이트리밋**: 플러그인 토큰별 버킷. ⚠️ 이 호출들도 결국 단일 admin Client 키(720/분)를 거치므로 **보수적 한도**(예: 분당 60) + 감사 로그.
- 응답은 패널 도메인 형태(키·내부 식별자 누출 없이 식별자/이름/리소스만).

---

## 7. 이벤트 webhook

- **발행**: 액션 레이어에 `emitEvent(type, { serverIdentifier, actorUserId, data })` 훅 추가(기존 `audit()` 지점과 병행). MVP 타입: `server.power`, `server.command`, `backup.create`, `backup.restore`, `file.write`, `file.delete`, `server.create`(관리자), `server.delete`.
- **디스패치**: 이벤트의 대상 서버에 대해 **(a) 그 서버에 접근 가능한 소유자의 플러그인 + (b) 해당 이벤트 구독 + (c) `enabled` + `webhookUrl` 존재**를 찾아 전송. **소유자 스코프 필터**(플러그인은 자기 소유자가 접근 가능한 서버 이벤트만 수신).
- **전송**: `POST webhookUrl` + 헤더 `X-Pteron-Event`, `X-Pteron-Signature: sha256=HMAC(secret, timestamp + "." + body)`, `X-Pteron-Timestamp`(리플레이 방지). 본문 `{ id, event, server, actor, timestamp, data }`.
- **신뢰성**: 백그라운드 fire-and-forget + 지수 백오프 재시도(예: 3회), `WebhookDelivery` 로그(status/attempts/responseCode). 실패 시 UI에서 수동 재시도. (전용 큐/cron은 후속.)
- 동기화/전달이 요청 경로를 막지 않도록 비동기.

---

## 8. UI iframe 확장

- 플러그인의 `uiTabUrl` 등록 시, **서버 뷰 탭 레지스트리(§17 seam)에 소유자별 플러그인 탭** 추가(라벨 = `uiTabLabel`). 탭은 소유자에게, 그의 접근 서버에서 노출.
- 렌더: `<iframe sandbox="allow-scripts allow-forms" src={uiTabUrl}>` — `allow-same-origin` **미포함**(플러그인 origin과 격리). CSP `frame-src`로 등록된 플러그인 origin만 허용.
- **단기 컨텍스트 토큰**: 부모가 iframe 로드 후 `postMessage`로 단기(예 5분) 컨텍스트 토큰을 전달 → iframe이 `/api/ext/*`를 소유자 스코프로 호출. 장기 `ptex_`는 iframe URL/코드에 넣지 않음. (컨텍스트 토큰도 tokenHash 계열로 발급·검증, 만료 짧음.)
- iframe→부모 postMessage는 origin 검증.

---

## 9. 보안

- **마스터 키 절대 비노출**: 플러그인 API도 서버측 `lib/ptero` 경유. 토큰/시크릿/키 어느 것도 브라우저·플러그인에 노출 안 됨(플러그인엔 `ptex_`만, 마스터 키 아님).
- **소유자 스코프 강제**: 모든 `/api/ext` 호출·이벤트가 `resolveAccessibleServers(owner)` + `requireServerAccess/Permission`를 통과 → 플러그인은 소유자 권한 초과 불가. 소유자 권한이 줄면(서브유저 해제 등) 다음 호출부터 즉시 반영(라이브 해석).
- **토큰**: `ptex_` 원문 1회, HMAC 해시 저장, 회전·취소(비활성/삭제) 즉시 반영.
- **webhook**: HMAC 서명 + timestamp(리플레이 방지). 시크릿 암호화 저장.
- **iframe**: sandbox(동일 출처 미허용) + 단기 컨텍스트 토큰 + CSP `frame-src`.
- **레이트리밋**: 토큰별. 플러그인 동작 감사 로그.
- **입력 검증**: 등록 입력(URL은 http/https, SSRF 방지로 사설 IP webhook 차단 옵션), 이벤트 페이로드 화이트리스트.

---

## 10. 테스트 전략

- 단위: 토큰 발급/해시/검증, 컨텍스트 토큰 만료, HMAC 서명/검증, 이벤트 소유자-스코프 필터, `/api/ext` 인증→소유자 스코프 매핑.
- 통합(MSW + DB): `/api/ext/servers`가 **소유자 스코프로만** 반환(타 서버 접근 차단), 비활성 플러그인 401, webhook 디스패치가 구독·스코프 일치 플러그인에만, 전송 로그 기록.
- e2e(Playwright): 플러그인 등록→토큰 1회 표시→비활성화→토큰 무효; (모킹 외부 서비스로) webhook 수신·서명 검증; iframe 탭 렌더.
- **보안 회귀**: 한 사용자의 `ptex_` 토큰으로 **다른 사용자 서버 접근 시도 → 차단(404/스코프 외)**.

---

## 11. 구현 분해 (writing-plans에서 6a/6b/6c)

- **6a — 등록·토큰·스코프 API**: `Plugin`/`WebhookDelivery` 모델·마이그레이션, `lib/crypto`(AES-GCM), 토큰 발급/검증, 라이프사이클 서버 액션, `(panel)/account/plugins` UI, `/api/ext/*` 인증 + MVP 표면(소유자 스코프). → 그 자체로 동작(외부 서비스가 API 호출 가능).
- **6b — 이벤트 webhook**: `emitEvent` 훅(액션 레이어), 디스패처(소유자 필터·HMAC·백오프·로그), 전송 로그 UI·수동 재시도.
- **6c — UI iframe 확장**: 탭 레지스트리 연동(소유자 플러그인 탭), iframe 샌드박스 + 단기 컨텍스트 토큰 + postMessage SDK + CSP.

각 하위 계획은 자체 spec 불필요(본 문서가 spec) — writing-plans가 본 문서를 근거로 6a/6b/6c plan을 만든다.

---

## 12. 리스크 / 오픈 이슈

- **R1 레이트리밋 공유 버킷**: `/api/ext` 호출도 단일 admin Client 키(720/분)를 거침 → 토큰별 보수적 한도 + 라이브 데이터는 webhook/이벤트로 유도. 대규모는 재평가.
- **R2 webhook 신뢰성**: fire-and-forget + 재시도 + 로그(MVP). 정확히-한-번/순서 보장은 후속(큐).
- **R3 SSRF**: webhook URL이 사설망을 때릴 수 있음 → 등록 시 사설 IP 차단 옵션·문서화.
- **R4 컨텍스트 토큰**: iframe용 단기 토큰의 발급/만료/검증을 견고히(누출 시 단기 피해로 한정).
- **R5 이벤트 커버리지**: 패널 밖 직접 Wings 조작은 이벤트로 안 잡힘(설계상 한계, 문서화). Wings 상태 이벤트는 후속.
- **R6 암호화 키 관리**: `webhookSecretEnc` 복호 키는 `SESSION_SECRET`에서 **HKDF로 파생**(별도 env 불필요). `SESSION_SECRET` 회전 시 기존 webhook 시크릿 재암호화가 필요 — 마이그레이션/회전 절차 문서화.

---

## 13. 완료 기준 (Phase 6 전체)

- [ ] 사용자가 플러그인 등록 → `ptex_` 토큰·webhook 시크릿 1회 표시, 활성/비활성/회전/삭제 동작.
- [ ] `/api/ext/*`가 토큰 인증 + **소유자 스코프 강제**(타 사용자 서버 접근 차단), 비활성 토큰 401, 레이트리밋.
- [ ] 패널 동작 시 구독·스코프 일치 플러그인에 **HMAC 서명 webhook** 전송, 전송 로그·재시도.
- [ ] 플러그인 UI가 **샌드박스 iframe** 탭으로 노출, 단기 컨텍스트 토큰으로 `/api/ext` 호출.
- [ ] 마스터 키·세션·타 테넌트 데이터 어디에도 비노출(검증).
- [ ] 단위·통합·e2e + 보안 회귀(크로스 유저 차단) 그린, build 성공.
- [ ] README: 플러그인 작성 가이드(토큰·webhook 서명 검증·이벤트 페이로드·iframe).

---

*(끝 — 외부 통합 모델로 "신뢰 불가 풀 확장"을 안전하게 제공. 구현은 6a→6b→6c.)*
