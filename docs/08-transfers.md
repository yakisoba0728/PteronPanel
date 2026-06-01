[← 전체 목차](./README.md)

# 8. 서버 이전 (Transfers)

## 8.1 이전 시작 (송신)

서버를 다른 노드로 이전합니다.

```
POST /api/servers/:server/transfer
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `url` | string | ✅ | 대상 노드의 이전 엔드포인트 URL |
| `token` | string | ✅ | 대상 노드 인증용 JWT |
| `server` | object | ✅ | 서버 설정 |
| `server.uuid` | string | ✅ | 서버 UUID |
| `server.start_on_completion` | boolean | 선택 | 이전 완료 후 자동 시작 (기본값: false) |

**응답:** `202 Accepted`

**에러 응답:** `409` (이미 이전 진행 중), `500` (서버 정지 실패)

> 서버는 이전 전에 오프라인 상태여야 합니다. 실행 중이면 자동으로 정지합니다 (최대 15초 대기).

**이전 프로세스:**

1. 서버가 실행 중이면 정지 (최대 15초 대기)
2. 모든 서버 파일의 압축 아카이브 생성
3. 대상 노드로 스트리밍 (5초마다 진행률 업데이트)
4. SHA-256 체크섬 전송하여 무결성 검증

> 이전 중복 시 `409 Conflict`가 발생합니다.

```bash
curl -X POST https://wings.example.com/api/servers/12345678/transfer \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://destination.example.com/api/transfers",
    "token": "Bearer DESTINATION_JWT_TOKEN",
    "server": {"uuid": "12345678-1234-1234-1234-123456789012", "start_on_completion": false}
  }'
```

## 8.2 이전 수신

다른 노드에서 들어오는 서버 이전을 수신합니다.

```
POST /api/transfers
```

**인증:** JWT (Panel에서 발급, 송신 노드에서 전달)

**요청 형식:** `multipart/form-data`

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `archive` | file | ✅ | tar.gz 서버 아카이브 (checksum보다 먼저 전송해야 함) |
| `checksum` | string | ✅ | 아카이브의 SHA-256 체크섬 |

**응답:** `200 OK`

**에러 응답:**

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 잘못된 형식 (`"invalid content type"`, `"archive must be sent before the checksum"`, `"missing archive or checksum"`, `"checksums don't match"`) |
| 401 | JWT 누락/무효 |
| 500 | 아카이브 추출 또는 환경 설정 실패 |

**수신 과정:**

1. JWT 검증 및 서버 UUID 추출
2. 서버 인스턴스 초기화
3. 아카이브를 디스크에 직접 스트리밍하면서 SHA-256 계산
4. 체크섬 비교로 무결성 검증
5. Docker 환경 구성
6. Panel에 성공/실패 알림

> 어느 단계에서든 실패하면 추출된 파일이 모두 삭제됩니다.

```bash
curl -X POST https://destination.example.com/api/transfers \
  -H "Authorization: Bearer JWT_TOKEN" \
  -F "archive=@/path/to/server-archive.tar.gz" \
  -F "checksum=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

## 8.3 이전 취소

진행 중인 서버 이전을 취소합니다.

**송신 취소:**

```
DELETE /api/servers/:server/transfer
```

**수신 취소:**

```
DELETE /api/transfers/:server
```

**응답:** `202 Accepted`

> 이전이 진행 중이 아닌 경우 `409 Conflict`가 발생합니다.
> 이미 `cancelling`, `cancelled`, `completed`, `failed` 상태인 경우에도 `409 Conflict`가 발생합니다.
> 전송 중 취소 시 대상 노드에 일부 데이터가 남을 수 있습니다.

**취소 프로세스:**

1. 이전 상태를 `cancelling`으로 업데이트
2. 컨텍스트 취소로 모든 진행 중인 작업 중단
3. 리소스 정리 및 활성 이전 목록에서 제거
4. 서버의 transferring 플래그 초기화

**이전 상태 흐름:**

```
pending → processing → completed
                    → cancelling → cancelled
                    → failed
```

```bash
# 송신 취소
curl -X DELETE https://wings.example.com/api/servers/12345678/transfer \
  -H "Authorization: Bearer YOUR_TOKEN"

# 수신 취소
curl -X DELETE https://destination.example.com/api/transfers/12345678 \
  -H "Authorization: Bearer YOUR_TOKEN"
```
