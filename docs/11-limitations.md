[← 전체 목차](./README.md)

# 11. 제한 사항

## WebSocket

| 항목 | 제한 |
|------|------|
| 동시 연결 | 서버당 최대 30개 |
| 메시지 속도 | 200ms당 10개 (초당 50개) |
| 압축 메시지 크기 | 4,096 bytes (4KB) |
| 비압축 메시지 크기 | 32,768 bytes (32KB) |

## 파일 업로드

| 항목 | 제한 |
|------|------|
| 파일 크기 | 기본 100MB (`api.upload_limit`에서 변경) |

## 원격 다운로드

| 항목 | 제한 |
|------|------|
| 타임아웃 | 15분 |

## CORS

```
Access-Control-Allow-Origin: <panel-location>
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Accept, Accept-Encoding, Authorization, Cache-Control, Content-Type, Content-Length, Origin, X-Real-IP, X-CSRF-Token
Access-Control-Max-Age: 7200
```

> `allowed_origins` 설정으로 추가 출처를 허용할 수 있습니다.
> `allow_cors_private_network` 활성화 시 `Access-Control-Request-Private-Network: true` 헤더가 추가되어 RFC1918 사설망에서의 CORS 요청이 허용됩니다.

## 신뢰할 수 있는 프록시

```yaml
api:
  trusted_proxies:
    - 127.0.0.1
    - 172.16.0.0/12
```

신뢰할 수 있는 프록시가 설정된 경우, Wings는 해당 IP의 `X-Forwarded-For` 헤더를 사용하여 실제 클라이언트 IP를 식별합니다.

---

**출처:** [Pterodactyl Wings 공식 문서](https://pterodactyl-wings.mintlify.app)
