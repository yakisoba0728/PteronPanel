[← 전체 목차](./README.md)

# 9. WebSocket 이벤트

## 클라이언트 → 서버

| 이벤트 | 인수 | 설명 |
|--------|------|------|
| `send command` | `[명령어 문자열]` | 콘솔에 명령어 전송 |
| `send logs` | `[]` | 과거 콘솔 로그 요청 |
| `send stats` | `[]` | 현재 서버 통계 요청 |
| `set state` | `["start" \| "stop" \| "restart" \| "kill"]` | 전원 상태 변경 |

## 서버 → 클라이언트

| 이벤트 | 인수 | 설명 |
|--------|------|------|
| `console output` | `[로그 줄]` | 실시간 콘솔 출력 |
| `status` | `["offline" \| "starting" \| "running" \| "stopping"]` | 서버 상태 변경 |
| `stats` | `[JSON 통계 문자열]` | 주기적 리소스 사용량 업데이트 |
| `throttled` | `["global"]` | 속도 제한 초과 시 전송 |
| `token expiring` | `[]` | JWT 만료 임박 알림 |
| `token expired` | `[]` | JWT 만료 알림 |
| `daemon message` | `[메시지]` | Wings 데몬 시스템 메시지 |
| `install output` | `[출력]` | 설치 진행 출력 |
| `install started` | `[]` | 설치 시작 |
| `install completed` | `[]` | 설치 완료 |
| `backup progress` | `[메시지]` | 백업 진행 상태 |
| `backup complete` | `[백업 UUID]` | 백업 완료 |
| `backup restore completed` | `[""]` | 백업 복원 완료 |
| `transfer.status` | `[상태 문자열]` | 이전 상태 변경 |
| `transfer.logs` | `[로그 메시지]` | 이전 진행 로그 |

## 연결 수명주기

1. JWT로 WebSocket 연결
2. 실시간 이벤트 수신 시작
3. 다음 경우 연결 종료:
   - 클라이언트 연결 해제
   - 서버 삭제
   - 서버 정지
   - 컨텍스트 취소
   - JWT 만료

## 종료 코드

| 코드 | 설명 |
|------|------|
| 1000 | 정상 종료 |
| 1001 | 연결 해제 |
| 1006 | 비정상 종료 (close frame 없음) |
| 1012 | 서비스 재시작 |
| 4409 | 서버 정지됨 (커스텀 코드) |
