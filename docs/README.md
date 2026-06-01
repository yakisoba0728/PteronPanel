# Pterodactyl Wings API Reference

Pterodactyl Wings는 Go/Gin 기반의 RESTful HTTP API를 제공합니다.
모든 API 요청은 Pterodactyl Panel 백엔드에서 시작되며, 직접 클라이언트 접근은 대부분 지원되지 않습니다.

## 목차

| # | 섹션 | 설명 |
|---|------|------|
| 1 | [개요](./01-overview.md) | Base URL, 엔드포인트 구조 |
| 2 | [인증](./02-authentication.md) | Bearer Token, JWT 인증 |
| 3 | [공통 응답 형식](./03-common-response.md) | 성공/에러 응답, 요청 추적 |
| 4 | [시스템 (System)](./04-system.md) | 시스템 정보 조회, 설정 업데이트 |
| 5 | [서버 관리 (Servers)](./05-servers.md) | 서버 CRUD, 전원 제어, 로그, WebSocket |
| 6 | [파일 관리 (Files)](./06-files.md) | 파일 CRUD, 압축, 권한, 업로드/다운로드 |
| 7 | [백업 (Backups)](./07-backups.md) | 백업 생성, 복원, 삭제, 다운로드 |
| 8 | [서버 이전 (Transfers)](./08-transfers.md) | 이전 시작, 수신, 취소 |
| 9 | [WebSocket 이벤트](./09-websocket.md) | 클라이언트/서버 이벤트, 종료 코드 |
| 10 | [에러 코드 요약](./10-error-codes.md) | HTTP 상태 코드, 파일시스템 에러 |
| 11 | [제한 사항](./11-limitations.md) | WebSocket, 업로드, CORS, 프록시 제한 |
