[← 전체 목차](./README.md)

# 4. 시스템 (System)

## 4.1 시스템 정보 조회

Wings 버전, Docker 정보, 하드웨어 사양을 반환합니다.

```
GET /api/system
```

**쿼리 파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `v` | string | 선택 | `"2"` 입력 시 상세 응답 반환. 미입력 시 레거시 간소 응답 |

**버전 2 응답 (권장):**

```json
{
  "version": "v1.11.0",
  "docker": {
    "version": "24.0.7",
    "cgroups": {
      "driver": "systemd",
      "version": "2"
    },
    "containers": {
      "total": 15,
      "running": 12,
      "paused": 0,
      "stopped": 3
    },
    "storage": {
      "driver": "overlay2",
      "filesystem": "extfs"
    },
    "runc": {
      "version": "1.1.10-0ubuntu1~22.04.1"
    }
  },
  "system": {
    "architecture": "amd64",
    "cpu_threads": 8,
    "memory_bytes": 16777216000,
    "kernel_version": "5.15.0-91-generic",
    "os": "Ubuntu 22.04.3 LTS",
    "os_type": "linux"
  }
}
```

**레거시 응답 (`v` 파라미터 없음):**

```json
{
  "architecture": "amd64",
  "cpu_count": 8,
  "kernel_version": "5.15.0-91-generic",
  "os": "linux",
  "version": "v1.11.0"
}
```

## 4.2 설정 업데이트

Wings 인스턴스의 실행 중인 설정을 업데이트합니다. 재시작 없이 즉시 적용됩니다.

```
POST /api/update
```

**요청 본문:**

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `debug` | boolean | 선택 | false | 디버그 모드 활성화 |
| `app_name` | string | 선택 | `"Pterodactyl"` | 애플리케이션 이름 |
| `uuid` | string | ✅ | — | 노드 UUID |
| `token_id` | string | ✅ | — | 토큰 ID |
| `token` | string | ✅ | — | 인증 토큰 |
| `api` | object | ✅ | — | API 서버 설정 |
| `api.host` | string | 선택 | `"0.0.0.0"` | 바인딩 주소 |
| `api.port` | integer | 선택 | `8080` | 바인딩 포트 |
| `api.ssl` | object | 선택 | — | SSL/TLS 설정 |
| `api.ssl.enabled` | boolean | 선택 | — | SSL 활성화 여부 |
| `api.ssl.cert` | string | 선택 | — | 인증서 경로 |
| `api.ssl.key` | string | 선택 | — | 개인키 경로 |
| `api.upload_limit` | integer | 선택 | `100` | 최대 업로드 크기 (MB) |
| `api.trusted_proxies` | array | 선택 | — | 신뢰할 프록시 IP 목록 |
| `api.disable_remote_download` | boolean | 선택 | — | 원격 다운로드 비활성화 |
| `system` | object | ✅ | — | 시스템 설정 |
| `system.root_directory` | string | 선택 | `/var/lib/pterodactyl` | 루트 디렉토리 |
| `system.log_directory` | string | 선택 | `/var/log/pterodactyl` | 로그 디렉토리 |
| `system.data` | string | 선택 | `/var/lib/pterodactyl/volumes` | 서버 데이터 디렉토리 |
| `system.archive_directory` | string | 선택 | `/var/lib/pterodactyl/archives` | 이전 아카이브 디렉토리 |
| `system.backup_directory` | string | 선택 | `/var/lib/pterodactyl/backups` | 백업 디렉토리 |
| `system.tmp_directory` | string | 선택 | `/tmp/pterodactyl` | 임시 디렉토리 |
| `system.username` | string | 선택 | `"pterodactyl"` | 시스템 사용자명 |
| `system.timezone` | string | 선택 | 자동 감지 | 컨테이너 시간대 |
| `docker` | object | ✅ | — | Docker 설정 |
| `remote` | string | ✅ | — | Panel URL |
| `remote_query.timeout` | integer | 선택 | `30` | Panel API 요청 타임아웃 (초) |
| `remote_query.boot_servers_per_page` | integer | 선택 | `50` | 부팅 시 페이지당 서버 수 |
| `allowed_mounts` | array | 선택 | — | 서버 마운트에 허용할 호스트 경로 목록 |
| `allowed_origins` | array | 선택 | — | 추가 CORS 허용 출처 |
| `ignore_panel_config_updates` | boolean | 선택 | `false` | Panel 설정 업데이트 무시 |

**요청 예시:**

```bash
curl -X POST "https://wings.example.com/api/update" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "uuid": "3e3e4e5e-6f7f-8a8a-9b9b-0c0c0d0d0e0e",
    "token_id": "abc123",
    "token": "your-authentication-token",
    "api": {
      "host": "0.0.0.0",
      "port": 8080,
      "ssl": { "enabled": true, "cert": "/etc/letsencrypt/live/wings.example.com/fullchain.pem", "key": "/etc/letsencrypt/live/wings.example.com/privkey.pem" },
      "upload_limit": 100
    },
    "system": { "root_directory": "/var/lib/pterodactyl", "data": "/var/lib/pterodactyl/volumes", "username": "pterodactyl" },
    "remote": "https://panel.example.com"
  }'
```

**응답:**

```json
{ "applied": true }
```

> `ignore_panel_config_updates`가 `true`이면 `{"applied": false}`를 반환하고 변경사항을 무시합니다.
