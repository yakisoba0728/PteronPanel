[← 전체 목차](./README.md)

# 2. 인증

Wings는 두 가지 인증 방식을 사용합니다:

1. **Bearer Token** — Panel ↔ Wings 간 API 통신용
2. **JWT (JSON Web Token)** — 특정 리소스에 대한 임시 접근용

## 2.1 Bearer Token 인증

대부분의 엔드포인트는 `/etc/pterodactyl/config.yml`에 설정된 정적 Bearer Token이 필요합니다.

**설정 (config.yml):**

```yaml
token_id: <token-id>
token: <your-secret-token>
```

**요청 예시:**

```bash
curl -X GET https://wings.example.com/api/system \
  -H "Authorization: Bearer <your-secret-token>" \
  -H "Content-Type: application/json"
```

**인증 흐름:**

1. `Authorization` 헤더에서 토큰 추출
2. 공백으로 분리하여 `Bearer` 프리픽스 확인
3. 타이밍 공격 방지를 위해 상수 시간 비교(`subtle.ConstantTimeCompare`) 수행
4. 일치 여부에 따라 요청 허용/거부

**에러 응답:**

| 상태 코드 | 의미 | 예시 |
|-----------|------|------|
| 401 | Authorization 헤더 누락/형식 오류 | `"The required authorization heads were not present in the request."` |
| 403 | 올바른 형식이지만 토큰 불일치 | `"You are not authorized to access this endpoint."` |

## 2.2 JWT 인증

JWT는 HMAC-SHA256(HS256)으로 서명되며, WebSocket 연결, 파일/백업 다운로드·업로드, 서버 이전에 사용됩니다.

### WebSocket JWT

**페이로드 구조:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `user_uuid` | string | ✅ | 사용자 UUID |
| `server_uuid` | string | ✅ | 서버 UUID |
| `permissions` | string[] | ✅ | 권한 목록 (예: `["control.console", "control.start"]`). 전체 접근 시 `["*"]` (관리자 권한은 제외) |
| `jti` | string | ✅ | 토큰 해지용 ID |
| `iat` | timestamp | ✅ | 발급 시간 |
| `exp` | timestamp | ✅ | 만료 시간 |

**연결 방법:**

```
GET /api/servers/:server/ws?token=<jwt>
```

**WebSocket 접근 해지:**

```bash
POST /api/deauthorize-user
Content-Type: application/json

{
  "user": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "servers": ["1a2b3c4d-5e6f-7890-1234-567890abcdef"]
}
```

> `servers` 배열을 생략하면 모든 서버에 대한 접근이 해지됩니다.

### 파일 다운로드 JWT

```
GET /download/file?token=<jwt>
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `file_path` | string | ✅ | 파일 경로 |
| `server_uuid` | string | ✅ | 서버 UUID |
| `unique_id` | string | 선택 | 일회성 사용 ID (선택사항) |
| `exp` | timestamp | ✅ | 만료 시간 |

### 백업 다운로드 JWT

```
GET /download/backup?token=<jwt>
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `server_uuid` | string | ✅ | 서버 UUID |
| `backup_uuid` | string | ✅ | 백업 UUID |
| `unique_id` | string | ✅ | 일회성 사용 ID |
| `exp` | timestamp | ✅ | 만료 시간 |

### 파일 업로드 JWT

```
POST /upload/file?token=<jwt>
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `server_uuid` | string | ✅ | 서버 UUID |
| `user_uuid` | string | ✅ | 사용자 UUID |
| `unique_id` | string | 선택 | 일회성 사용 ID (선택사항) |
| `exp` | timestamp | ✅ | 만료 시간 |

### 이전 JWT

```
POST /api/transfers
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `server_uuid` | string | ✅ | 이전할 서버 UUID |
| `exp` | timestamp | ✅ | 만료 시간 |
