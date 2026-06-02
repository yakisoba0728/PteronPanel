# Pteron Panel

Pterodactyl Panel 1.11.x를 두 개의 마스터 키(Application API + root-admin Client API)로만 운용하는 멀티테넌트 패널입니다. 브라우저는 절대 두 키를 보지 못하고, 서버가 모든 Panel 호출을 대행합니다.

## 핵심 키

- `PTERO_APP_KEY`: Admin > Application API에서 발급한 Application API key
- `PTERO_CLIENT_KEY`: root-admin 계정의 Account > API Credentials에서 발급한 Client API key

두 키는 서버 전용입니다. 브라우저 응답, 클라이언트 번들, 프런트엔드 로그에 노출되면 안 됩니다.

## Wings 설정

콘솔은 브라우저가 Wings WebSocket에 직접 연결하므로, 콘솔을 쓸 모든 노드의 `/etc/pterodactyl/config.yml`에 패널 origin을 추가해야 합니다.

```yaml
allowed_origins:
  - 'https://pteron.example.com'
```

정확히 scheme + host + port가 일치해야 합니다. 변경 후 Wings를 재시작하세요.

## 환경 변수

`.env.example`를 복사해 `.env`를 만든 뒤 아래 값을 채웁니다.

- `PANEL_URL`
- `PTERO_APP_KEY`
- `PTERO_CLIENT_KEY`
- `DATABASE_URL`
- `SESSION_SECRET`
- `APP_BASE_URL`
- `SEED_ADMIN_*`
- `SEED_USER_*`

## Docker 배포

```bash
docker compose up -d --build
docker compose run --rm seed
```

- `db`: PostgreSQL 16
- `migrate`: Prisma migrate deploy를 앱 시작 전에 1회 실행
- `seed`: 초기 관리자와 Pterodactyl 매핑 유저를 생성할 때 수동 실행
- `app`: Next.js standalone 런타임

`APP_BASE_URL`은 실제 접속 origin과 일치해야 합니다. 리버스 프록시 뒤에 둘 경우 TLS 종료 지점의 public URL로 맞추세요.
Docker Compose에서는 `DATABASE_URL`의 호스트가 `db`여야 합니다. 호스트 머신에서 직접 `pnpm prisma migrate dev`를 실행하는 개발 환경에서는 `.env`의 DB 호스트를 `localhost`로 바꾸세요.

## 운영 및 보안

앱은 모든 경로에 기본 보안 헤더를 설정합니다.

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

`/api/health`는 데이터베이스 연결을 확인하는 상태 엔드포인트입니다. 정상일 때 `{ "status": "ok" }`를 반환하고, DB 확인이 실패하면 HTTP 503과 `{ "status": "degraded" }`를 반환합니다. Docker Compose의 `app` 서비스 헬스체크도 이 엔드포인트를 사용합니다.

프로덕션 체크리스트:

- `PTERO_APP_KEY`와 `PTERO_CLIENT_KEY`는 서버 전용으로만 보관하고, 브라우저 응답/번들/로그에 노출하지 않습니다.
- 두 Pterodactyl 키는 가능한 경우 Pterodactyl Panel에서 앱 서버의 고정 IP만 허용하도록 제한합니다.
- 앱 서버의 egress는 Pterodactyl Panel, Wings 노드, 데이터베이스 등 필요한 대상만 허용합니다.
- HTTPS를 강제하고 `APP_BASE_URL`은 실제 public origin과 정확히 일치하게 설정합니다.
- 콘솔을 사용하는 모든 Wings 노드의 `allowed_origins`에 Pteron Panel의 HTTPS origin을 추가합니다.
- `SESSION_SECRET`은 충분히 긴 무작위 값으로 설정하고 저장소나 이미지에 포함하지 않습니다.
- 서브유저 권한 변경이 Pterodactyl에서 발생한 뒤에는 정기적으로 접근 스코프 동기화를 실행합니다.

## 개발

```bash
corepack enable
pnpm install
docker compose -f docker-compose.dev.yml up -d db
pnpm prisma migrate dev
pnpm dev
```

## 테스트

```bash
pnpm test
pnpm e2e
```

## 현재 슬라이스

로그인, 스코프된 서버 목록, 서버 개요, 전원 제어, 콘솔 WebSocket, 파일 매니저, 백업 관리, 스케줄·태스크 관리, 서브유저·권한 관리, 데이터베이스·네트워크·Startup·설정·활동로그, 관리자 유저·노드·로케이션 관리, 관리자 서버 생성/관리, Playwright e2e 스코프 검증, Docker 배포 문서가 포함되어 있습니다.

파일 매니저는 목록 탐색, 편집, 업로드/다운로드, 삭제, 폴더 생성을 지원합니다. 업로드/다운로드와 백업 다운로드는 서버 액션이 발급받은 signed URL로 브라우저가 직접 요청합니다. 원격 파일 풀 기능은 Pterodactyl Panel의 `api.disable_remote_download: false` 설정이 필요합니다.

서브유저로 참여 중인 서버를 USER 목록에 노출하려면 관리자가 `/admin`에서 서브유저 접근 동기화를 실행해야 합니다. 동기화는 모든 서버를 순차적으로 조회해 `ServerAccess` 캐시를 갱신합니다.
