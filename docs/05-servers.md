[← 전체 목차](./README.md)

# 5. 서버 관리 (Servers)

## 5.1 서버 목록 조회

Wings 인스턴스에 등록된 모든 서버를 반환합니다.

```
GET /api/servers
```

**응답:** 서버 객체 배열

**서버 객체 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `state` | string | 서버 상태: `offline`, `starting`, `running`, `stopping` |
| `is_suspended` | boolean | 정지 여부 |
| `utilization` | object | 리소스 사용량 |
| `utilization.state` | string | 현재 프로세스 상태 |
| `utilization.memory_bytes` | integer | 메모리 사용량 (bytes) |
| `utilization.memory_limit_bytes` | integer | 메모리 제한 (bytes) |
| `utilization.cpu_absolute` | number | CPU 사용률 (%) |
| `utilization.disk_bytes` | integer | 디스크 사용량 (bytes) |
| `utilization.network_rx_bytes` | integer | 네트워크 수신 (bytes) |
| `utilization.network_tx_bytes` | integer | 네트워크 송신 (bytes) |
| `utilization.uptime` | integer | 가동 시간 (ms) |
| `configuration` | object | 서버 설정 (UUID, 빌드, 컨테이너, 할당 등) |

**요청 예시:**

```bash
curl -X GET https://wings.example.com/api/servers \
  -H "Authorization: Bearer your-token"
```

## 5.2 서버 생성

새 서버를 생성하고 설치 프로세스를 시작합니다.

```
POST /api/servers
```

**요청 본문:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `uuid` | string | ✅ | — | 서버 UUID (UUIDv4 형식) |
| `start_on_completion` | boolean | 선택 | `false` | 설치 완료 후 자동 시작 여부 |

**응답:** `202 Accepted` (설치는 비동기로 진행)

**에러 응답:** `422` (UUID 형식 오류), `500` (서버 생성 실패)

```bash
curl -X POST https://wings.example.com/api/servers \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "uuid": "8d3f9a2e-5c7b-4f1e-9d2a-6e8f1c3b5a7d",
    "start_on_completion": true
  }'
```

## 5.3 서버 상세 조회

단일 서버의 상세 정보를 반환합니다.

```
GET /api/servers/:server
```

**경로 파라미터:**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `server` | string | 서버 UUID |

**응답:** [5.1 서버 목록](#51-서버-목록-조회)의 서버 객체와 동일한 형식

**`configuration` 하위 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `uuid` | string | 서버 UUID |
| `suspended` | boolean | 정지 여부 |
| `invocation` | string | 서버 시작 명령어 |
| `skip_egg_scripts` | boolean | Egg 설치 스크립트 건너뛰기 |
| `build` | object | 리소스 제한 (`memory_limit`, `swap`, `io_weight`, `cpu_limit`, `disk_space`, `threads`) |
| `container` | object | Docker 컨테이너 설정 (`image` 등) |
| `allocations` | object | 네트워크 할당 (`default.ip`, `default.port`, `mappings`) |

**에러 응답:** `404` (서버 없음)

```bash
curl -X GET https://wings.example.com/api/servers/8d3f9a2e-5c7b-4f1e-9d2a-6e8f1c3b5a7d \
  -H "Authorization: Bearer your-token"
```

## 5.4 서버 삭제

서버와 모든 관련 리소스를 삭제합니다.

```
DELETE /api/servers/:server
```

**경로 파라미터:**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `server` | string | 서버 UUID |

**응답:** `204 No Content`

**에러 응답:** `404` (서버 없음), `500` (삭제 실패)

**동작 순서:**

1. 서버를 즉시 정지 상태로 전환
2. 모든 WebSocket 클라이언트에 삭제 이벤트 전송
3. WebSocket 연결 강제 종료
4. 백그라운드 작업 정리
5. 원격 파일 다운로드 취소
6. Docker 컨테이너 강제 제거
7. 서버 파일 비동기 삭제

```bash
curl -X DELETE https://wings.example.com/api/servers/8d3f9a2e-5c7b-4f1e-9d2a-6e8f1c3b5a7d \
  -H "Authorization: Bearer your-token"
```

## 5.5 서버 전원 제어

서버의 전원 상태를 변경합니다. 비동기로 처리되며 즉시 응답합니다.

```
POST /api/servers/:server/power
```

**경로 파라미터:**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `server` | string | 서버 UUID |

**요청 본문:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `action` | string | ✅ | — | `start`, `stop`, `restart`, `kill` 중 하나 |
| `wait_seconds` | integer | 선택 | `30` | 잠금 대기 시간 (0~300초) |

**액션별 동작:**

| 액션 | 설명 |
|------|------|
| `start` | 서버가 `offline` 상태일 때만 동작. 정지된 서버는 차단됨 |
| `stop` | 최대 10분 대기 후 정상 종료. 실패 시 terminate signal로 강제 종료 |
| `restart` | stop + start 조합. 정지 완료 후 시작. 정지된 서버는 차단됨 |
| `kill` | SIGKILL로 즉시 종료. 잠금을 무시하고 실행 |

**전원 액션 잠금:**

- `kill`을 제외한 모든 액션은 독점 잠금 획득 필요
- `wait_seconds`로 잠금 대기 시간 제어 (기본 30초)
- `kill`은 잠금 획득을 시도하지만 실패해도 진행

**사전 부팅 과정 (start/restart):**

1. Panel에서 서버 설정 동기화
2. 정지 상태 확인
3. 환경 변수 및 리소스 제한 동기화
4. 디스크 공간 확인
5. 설정 파일 업데이트
6. 파일 권한 설정 (설정 활성화 시)

**에러 응답:**

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 정지된 서버는 start/restart 불가 |
| 404 | 서버를 찾을 수 없음 |
| 422 | 잘못된 power action 값 |

**응답:** `202 Accepted`

```bash
curl -X POST https://wings.example.com/api/servers/8d3f9a2e/power \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'
```

## 5.6 콘솔 명령어 전송

실행 중인 서버에 콘솔 명령어를 전송합니다.

```
POST /api/servers/:server/commands
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `commands` | string[] | ✅ | 명령어 배열 (순차 실행) |

**응답:** `204 No Content`

> 서버가 실행 중이 아닌 경우 `502 Bad Gateway`를 반환합니다.
> 개별 명령어 실패는 전체 요청을 실패시키지 않습니다.

**에러 응답:** `404` (서버 없음), `502` (서버 미실행), `500` (서버 실행 상태 확인 실패)

```bash
curl -X POST https://wings.example.com/api/servers/8d3f9a2e/commands \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"commands": ["say Maintenance in 5min", "save-all"]}'
```

## 5.7 서버 설치 실행

서버 설치 프로세스를 트리거합니다.

```
POST /api/servers/:server/install
```

**응답:** `202 Accepted` (비동기)

**에러 응답:** `404` (서버 없음)

**설치 과정:**

1. Panel에서 최신 설정 동기화
2. Docker 이미지 풀 (필요 시)
3. 설치 컨테이너 실행
4. Egg 설치 스크립트 실행
5. 필요 파일 다운로드

```bash
curl -X POST https://wings.example.com/api/servers/8d3f9a2e/install \
  -H "Authorization: Bearer your-token"
```

## 5.8 서버 동기화

Panel의 현재 설정으로 로컬 서버 상태를 업데이트합니다.

```
POST /api/servers/:server/sync
```

**응답:** `204 No Content`

**에러 응답:** `404` (서버 없음), `500` (Panel 동기화 실패)

**동기화 항목:**

- 서버 설정 (빌드, 할당, 리소스 제한)
- 시작 명령어, 환경 변수
- Docker 이미지
- 정지 상태
- 크래시 감지 설정

> 서버가 정지 상태인 경우 모든 WebSocket 및 SFTP 연결이 해제됩니다. JWT는 유효하지만 연결이 거부됩니다.
> 서버 시작 전에 자동으로 동기화가 실행됩니다.
> 환경 변수 변경은 다음 서버 시작 시 적용됩니다. 리소스 제한은 즉시 적용됩니다.

```bash
curl -X POST https://wings.example.com/api/servers/8d3f9a2e/sync \
  -H "Authorization: Bearer your-token"
```

## 5.9 서버 로그 조회

서버 콘솔 로그의 최근 N줄을 반환합니다.

```
GET /api/servers/:server/logs
```

**쿼리 파라미터:**

| 파라미터 | 타입 | 기본값 | 범위 | 설명 |
|----------|------|--------|------|------|
| `size` | integer | `100` | 1~100 | 가져올 로그 줄 수 |

**응답:**

```json
{
  "data": [
    "[10:30:15] [Server thread/INFO]: Starting minecraft server version 1.20.1",
    "[10:30:20] [Server thread/INFO]: Done (5.234s)!"
  ]
}
```

**에러 응답:** `404` (서버 없음), `500` (로그 읽기 실패)

```bash
curl -X GET "https://wings.example.com/api/servers/8d3f9a2e/logs?size=50" \
  -H "Authorization: Bearer your-token"
```

## 5.10 WebSocket 연결

실시간 콘솔 출력, 통계, 명령어 실행을 위한 WebSocket 연결입니다.

```
GET /api/servers/:server/ws
```

> Bearer Token이 아닌 **JWT** 인증이 필요합니다. 연결 후 `auth` 이벤트로 JWT를 전송합니다.

**연결 인증 흐름:**

1. WebSocket 엔드포인트에 연결 (토큰 없이)
2. Wings가 연결을 업그레이드
3. 클라이언트가 `auth` 이벤트로 JWT 전송:

```json
{"event": "auth", "args": ["<jwt-token>"]}
```

4. Wings가 JWT와 권한 검증
5. 연결 인증 완료

**제한 사항:**

- 서버당 최대 30개 동시 연결
- 메시지 크기: 압축 4KB / 비압축 32KB
- 글로벌 속도 제한: 200ms당 10메시지 (초당 50메시지)

**정지된 서버:**

WebSocket 연결은 설정되지만 즉시 종료 코드 `4409`와 함께 닫힙니다.
