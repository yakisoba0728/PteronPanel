[← 전체 목차](./README.md)

# 1. 개요

## Base URL

```
http://<wings-host>:<port>/api
```

- **Host**: `0.0.0.0` (기본값)
- **Port**: `8080` (config.yml에서 변경 가능)
- **SSL**: 선택사항 (`api.ssl` 설정)

## 엔드포인트 구조

| 그룹 | 엔드포인트 | 설명 |
|------|-----------|------|
| **시스템** | `POST /api/update` | Wings 설정 업데이트 |
| | `GET /api/system` | 시스템 정보 조회 |
| | `GET /api/servers` | 전체 서버 목록 |
| | `POST /api/servers` | 서버 생성 |
| | `POST /api/deauthorize-user` | 사용자 WebSocket 접근 해지 |
| **서버 관리** | `GET /api/servers/:server` | 서버 상세 정보 |
| | `DELETE /api/servers/:server` | 서버 삭제 |
| | `GET /api/servers/:server/logs` | 서버 로그 |
| | `POST /api/servers/:server/power` | 전원 제어 |
| | `POST /api/servers/:server/commands` | 콘솔 명령어 |
| | `POST /api/servers/:server/install` | 설치 실행 |
| | `POST /api/servers/:server/reinstall` | 재설치 |
| | `POST /api/servers/:server/sync` | Panel과 동기화 |
| | `POST /api/servers/:server/ws/deny` | WebSocket 토큰 거부 |
| **파일 관리** | `GET /api/servers/:server/files/contents` | 파일 읽기 |
| | `GET /api/servers/:server/files/list-directory` | 디렉토리 목록 |
| | `PUT /api/servers/:server/files/rename` | 이름 변경/이동 |
| | `POST /api/servers/:server/files/copy` | 파일 복사 |
| | `POST /api/servers/:server/files/write` | 파일 쓰기 |
| | `POST /api/servers/:server/files/create-directory` | 디렉토리 생성 |
| | `POST /api/servers/:server/files/delete` | 파일 삭제 |
| | `POST /api/servers/:server/files/compress` | 압축 |
| | `POST /api/servers/:server/files/decompress` | 압축 해제 |
| | `POST /api/servers/:server/files/chmod` | 권한 변경 |
| **원격 다운로드** | `GET /api/servers/:server/files/pull` | 다운로드 상태 |
| | `POST /api/servers/:server/files/pull` | 원격 다운로드 시작 |
| | `DELETE /api/servers/:server/files/pull/:download` | 다운로드 취소 |
| **백업** | `POST /api/servers/:server/backup` | 백업 생성 |
| | `POST /api/servers/:server/backup/:backup/restore` | 백업 복원 |
| | `DELETE /api/servers/:server/backup/:backup` | 백업 삭제 |
| **서명된 URL** | `GET /download/backup` | 백업 다운로드 (JWT) |
| | `GET /download/file` | 파일 다운로드 (JWT) |
| | `POST /upload/file` | 파일 업로드 (JWT) |
| | `GET /api/servers/:server/ws` | WebSocket 연결 (JWT) |
| **이전** | `POST /api/servers/:server/transfer` | 이전 시작 (송신) |
| | `POST /api/transfers` | 이전 수신 |
| | `DELETE /api/servers/:server/transfer` | 송신 이전 취소 |
| | `DELETE /api/transfers/:server` | 수신 이전 취소 |
