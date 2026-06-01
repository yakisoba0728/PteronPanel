[← 전체 목차](./README.md)

# 6. 파일 관리 (Files)

## 6.1 디렉토리 목록 조회

서버 디렉토리의 파일/폴더 목록을 반환합니다.

```
GET /api/servers/:server/files/list-directory
```

**쿼리 파라미터:**

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `directory` | string | `/` | 조회할 디렉토리 경로 |

**응답:** 파일 stat 객체 배열

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | string | 파일/디렉토리명 |
| `mode` | string | Unix 파일 모드 (예: `"-rw-r--r--"`) |
| `mode_bits` | string | 8진수 모드 (예: `"0644"`) |
| `size` | integer | 크기 (bytes) |
| `is_file` | boolean | 파일 여부 |
| `is_symlink` | boolean | 심볼릭 링크 여부 |
| `mimetype` | string | MIME 타입 |
| `created_at` | string | 생성 시간 (ISO 8601) |
| `modified_at` | string | 수정 시간 (ISO 8601) |

> 디렉토리가 먼저 정렬되고, 그 다음 파일이 알파벳 순으로 정렬됩니다.

```bash
curl -X GET "https://wings.example.com/api/servers/d3aac109/files/list-directory?directory=/logs" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 6.2 파일 읽기

서버의 파일 내용을 읽습니다.

```
GET /api/servers/:server/files/contents
```

**쿼리 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `file` | string | ✅ | 파일 경로 |
| `download` | string | 선택 | 존재 시 다운로드 헤더 포함 |

**응답 헤더:**

- `X-Mime-Type`: 파일 MIME 타입
- `Content-Length`: 파일 크기
- `Content-Disposition`: `download` 파라미터 있을 시 `attachment`

```bash
curl -X GET "https://wings.example.com/api/servers/d3aac109/files/contents?file=server.properties" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 6.3 파일 쓰기

서버에 파일을 쓰거나 덮어씁니다.

```
POST /api/servers/:server/files/write
```

**쿼리 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `file` | string | ✅ | 파일 경로 |

**요청 본문:** 파일의 원시 내용 (Content-Type에 맞게 설정)

**응답:** `204 No Content`

> 파일이 없으면 생성, 있으면 덮어씁니다. 상위 디렉토리도 자동 생성됩니다.
> `.pteroignore`에 등록된 파일은 쓸 수 없습니다.

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/write?file=server.properties" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: text/plain" \
  -d "gamemode=survival
difficulty=normal
motd=My Minecraft Server"
```

## 6.4 파일 업로드 (JWT)

서명된 URL을 통해 파일을 업로드합니다.

```
POST /upload/file?token=<jwt>
```

**인증:** JWT (Bearer Token 아님)

**요청 형식:** `multipart/form-data`

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `files` | file[] | ✅ | 업로드할 파일(들) |
| `directory` | string | 선택 | 대상 디렉토리 (기본값: `/`) |

**응답:** `204 No Content`

> 업로드 제한: 기본 100MB (`api.upload_limit`에서 변경 가능)
> 동일 이름의 기존 파일은 덮어씁니다.

```bash
curl -X POST "https://wings.example.com/upload/file?token=SIGNED_JWT_TOKEN" \
  -F "files=@/path/to/file.txt" \
  -F "files=@/path/to/another.zip" \
  -F "directory=/uploads"
```

## 6.5 파일 다운로드 (JWT)

서명된 URL을 통해 파일을 다운로드합니다.

```
GET /download/file?token=<jwt>
```

**인증:** JWT (Bearer Token 아님)

**응답:** 파일 원시 내용 + 다운로드 헤더

> JWT는 일반적으로 일회성이며, 사용 후 무효화됩니다. 파일 내용은 스트리밍으로 전송됩니다.

**에러 응답:** `401` (JWT 무효/이미 사용됨), `404` (파일 없음), `500` (파일 읽기 실패)

```bash
curl -X GET "https://wings.example.com/download/file?token=SIGNED_JWT_TOKEN" \
  -o downloaded-file.txt
```

## 6.6 파일 이름 변경 / 이동

파일이나 디렉토리의 이름을 변경하거나 이동합니다.

```
PUT /api/servers/:server/files/rename
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `root` | string | ✅ | 기준 디렉토리 |
| `files` | array | ✅ | `{from: string, to: string}` 객체 배열 |

**응답:** `204 No Content`

> 대상 파일이 이미 존재하면 `400` 에러가 발생합니다.
> 여러 작업이 동시에 처리됩니다.

```bash
curl -X PUT "https://wings.example.com/api/servers/d3aac109/files/rename" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"root": "/", "files": [{"from": "old.yml", "to": "new.yml"}]}'
```

## 6.7 파일 복사

파일을 새 위치에 복사합니다. (디렉토리 복사는 지원하지 않음)

```
POST /api/servers/:server/files/copy
```

**쿼리 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `file` | string | ✅ | 원본 파일 경로 |

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `location` | string | ✅ | 대상 파일 경로 |

**응답:** `204 No Content`

> 디렉토리를 복사하려면 압축 → 압축 해제 방식을 사용하세요.

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/copy?file=server.properties" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"location": "server.properties.bak"}'
```

## 6.8 파일 삭제

파일이나 디렉토리를 삭제합니다.

```
POST /api/servers/:server/files/delete
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `root` | string | ✅ | 기준 디렉토리 |
| `files` | string[] | ✅ | 삭제할 파일/디렉토리 경로 배열 |

**응답:** `204 No Content`

> 디렉토리는 재귀적으로 삭제됩니다. 삭제는 복구할 수 없습니다.
> 여러 작업이 동시에 처리됩니다.

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/delete" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"root": "/", "files": ["old-log.txt", "cache/"]}'
```

## 6.9 파일 압축

파일이나 디렉토리를 `.tar.gz` 아카이브로 압축합니다.

```
POST /api/servers/:server/files/compress
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `root` | string | ✅ | 기준 디렉토리 |
| `files` | string[] | ✅ | 압축할 파일/디렉토리 경로 배열 |

**응답:** 생성된 아카이브 정보

```json
{
  "file": {
    "name": "archive-2024-01-15-143022.tar.gz",
    "mode": "-rw-r--r--",
    "mode_bits": "0644",
    "size": 52428800,
    "is_file": true,
    "is_symlink": false,
    "mimetype": "application/gzip",
    "created_at": "2024-01-15T14:30:22Z",
    "modified_at": "2024-01-15T14:30:22Z"
  }
}
```

> 파일명 형식: `archive-YYYY-MM-DD-HHMMSS.tar.gz`

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/compress" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"root": "/", "files": ["world", "server.properties"]}'
```

## 6.10 압축 해제

압축 파일을 해제합니다.

```
POST /api/servers/:server/files/decompress
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `root` | string | ✅ | 압축 파일이 위치한 디렉토리 |
| `file` | string | ✅ | 압축 파일 경로 |

**응답:** `204 No Content`

**지원 형식:** `.tar.gz`, `.tgz`, `.tar`, `.zip`, `.rar`, `.7z`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`, `.tar.lz`

> 압축 해제 후 원본 아카이브 파일은 자동으로 삭제됩니다.

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/decompress" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"root": "/", "file": "backup.tar.gz"}'
```

## 6.11 파일 권한 변경

파일/디렉토리의 Unix 권한을 변경합니다.

```
POST /api/servers/:server/files/chmod
```

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `root` | string | ✅ | 기준 디렉토리 |
| `files` | array | ✅ | `{file: string, mode: string}` 객체 배열 |

**응답:** `204 No Content`

**자주 사용하는 권한 모드:**

| 모드 | 기호 | 설명 |
|------|------|------|
| `0644` | `-rw-r--r--` | 일반 파일 (소유자 읽기/쓰기, 나머지 읽기) |
| `0755` | `-rwxr-xr-x` | 실행 파일/디렉토리 |
| `0600` | `-rw-------` | 개인 파일 |
| `0700` | `-rwx------` | 개인 실행 파일 또는 디렉토리 (소유자만) |
| `0777` | `-rwxrwxrwx` | 전체 접근 가능 (권장하지 않음) |

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/chmod" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"root": "/", "files": [{"file": "start.sh", "mode": "0755"}]}'
```

## 6.12 원격 파일 다운로드

원격 URL에서 서버로 파일을 직접 다운로드합니다.

```
POST /api/servers/:server/files/pull
```

> **필수 설정:** `config.yml`에서 `api.disable_remote_download: false`여야 합니다.

**요청 본문:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `url` | string | ✅ | — | 다운로드할 원격 URL (HTTP/HTTPS) |
| `directory` | string | ✅ | — | 저장할 디렉토리 |
| `filename` | string | 선택 | URL에서 추출 | 저장할 파일명 |
| `use_header` | boolean | 선택 | `false` | Content-Disposition 헤더의 파일명 사용 |
| `foreground` | boolean | 선택 | `false` | 전경 다운로드 (완료까지 대기) |

**응답:** `204 No Content`

> 타임아웃: 15분. 리디렉션(3xx)을 따릅니다.

```bash
curl -X POST "https://wings.example.com/api/servers/d3aac109/files/pull" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/plugin.jar", "directory": "/plugins"}'
```
