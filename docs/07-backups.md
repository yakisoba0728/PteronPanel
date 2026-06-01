[← 전체 목차](./README.md)

# 7. 백업 (Backups)

## 7.1 백업 생성

서버 백업을 생성합니다. 비동기로 처리됩니다.

```
POST /api/servers/:server/backup
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `adapter` | string | ✅ | 스토리지 어댑터: `wings` (로컬) 또는 `s3` |
| `uuid` | string | ✅ | 백업 UUID (Panel에서 생성) |
| `ignore` | string | 선택 | 제외할 파일 패턴 (줄바꿈 구분) |

**응답:** `202 Accepted`

**백업 프로세스:**

1. 요청 수락 → 즉시 응답
2. `.tar.gz` 아카이브 생성 (ignore 패턴과 `.pteroignore` 적용)
3. SHA1 체크섬 계산
4. 로컬 저장 또는 S3 업로드 (청크당 5MB)
5. Panel에 완료 알림 (크기, 체크섬, 성공 여부)

**ignore 패턴 예시:**

```
*.log
temp/
cache/**
node_modules/
```

> 패턴은 `.gitignore`와 동일한 규칙으로 매칭됩니다.
> 디스크 I/O는 `system.backup_write_limit`(config.yml)로 제한 가능합니다.

**에러 응답:** `400` (잘못된 어댑터), `401` (인증 실패), `404` (서버 없음), `409` (이미 존재하는 백업 UUID), `500` (백업 생성 실패)

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/backup" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"adapter": "wings", "uuid": "550e8400-e29b-41d4-a716-446655440000", "ignore": "*.log\ntemp/"}'
```

## 7.2 백업 복원

백업 아카이브에서 서버를 복원합니다.

```
POST /api/servers/:server/backup/:backup/restore
```

**경로 파라미터:**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `server` | string | 서버 UUID |
| `backup` | string | 백업 UUID |

**요청 본문:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `adapter` | string | ✅ | — | `wings` 또는 `s3` |
| `truncate_directory` | boolean | 선택 | `false` | 복원 전 기존 파일 전체 삭제 여부 |
| `download_url` | string | 조건 | — | S3 백업 시 필수. Pre-signed URL |

**응답:** `202 Accepted` (비동기)

**에러 응답:** `400` (S3의 download_url 누락/Content-Type 오류), `401` (인증 실패), `404` (서버/백업 없음), `500` (복원 실패)

**복원 과정:**

1. 서버를 "restoring" 상태로 전환
2. `truncate_directory: true`인 경우 기존 파일 전체 삭제
3. 로컬 또는 S3에서 백업 검색
4. tar.gz 아카이브 추출
5. 완료 시 WebSocket 이벤트 + Panel 알림

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/backup/550e8400/restore" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"adapter": "wings", "truncate_directory": true}'
```

## 7.3 백업 삭제

Wings 노드에서 로컬 백업을 삭제합니다.

```
DELETE /api/servers/:server/backup/:backup
```

**응답:** `204 No Content`

> 멱등성: 백업이 존재하지 않아도 `204`를 반환합니다.
> S3 백업은 Panel 또는 S3에서 직접 삭제해야 합니다.
> 이 엔드포인트는 Wings 노드의 백업 파일만 삭제합니다. Panel DB의 백업 레코드는 자동으로 제거되지 않습니다.

**에러 응답:** `401` (인증 실패), `404` (서버 없음), `500` (백업 삭제 실패)

```bash
curl -X DELETE "https://wings.example.com/api/servers/d3aac109/backup/550e8400" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 7.4 백업 다운로드 (JWT)

서명된 URL을 통해 백업 파일을 다운로드합니다.

```
GET /download/backup?token=<jwt>
```

**인증:** JWT (Bearer Token 아님)

**JWT 페이로드:** `server_uuid`, `backup_uuid`, `unique_id`

**응답:** 백업 아카이브 파일 (`.tar.gz`)

> JWT는 일반적으로 일회성입니다. 로컬 백업만 다운로드 가능합니다.

**에러 응답:** `401` (JWT 무효/이미 사용됨), `404` (백업 없음 - S3에 있을 수 있음), `500` (백업 파일 읽기 실패)

```bash
curl -X GET "https://wings.example.com/download/backup?token=SIGNED_JWT_TOKEN" \
  -o backup.tar.gz
```
