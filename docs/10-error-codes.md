[← 전체 목차](./README.md)

# 10. 에러 코드 요약

| 상태 코드 | 의미 | 설명 | 대표 에러 메시지 |
|-----------|------|------|------------------|
| 400 | Bad Request | 잘못된 요청 데이터 | `"The data passed in the request was not in a parsable format."` |
| 401 | Unauthorized | 인증 헤더 누락/형식 오류 | `"The required authorization heads were not present in the request."` |
| 403 | Forbidden | 인증됨, 권한 없음 | `"You are not authorized to access this endpoint."` |
| 404 | Not Found | 리소스 없음 | `"The requested resource does not exist on this instance."` |
| 409 | Conflict | 충돌 (이미 진행 중인 작업 등) | `"A transfer is already in progress for this server."` |
| 413 | Payload Too Large | 업로드 크기 초과 | `"File example.zip is larger than the maximum file upload size of 100 MB."` |
| 422 | Unprocessable Entity | 유효성 검사 실패 | `"The data provided in the request could not be validated."` |
| 500 | Internal Server Error | 서버 내부 오류 | `"An unexpected error was encountered while processing this request"` |
| 502 | Bad Gateway | 잘못된 서버 상태 | `"Cannot send commands to a stopped server instance."` |
| 504 | Gateway Timeout | 요청 처리 시간 초과 | `"The server could not process this request in time, please try again."` |

## 파일시스템 특정 에러

| 메시지 | 설명 |
|--------|------|
| `"The requested resources was not found on the system."` | 파일을 찾을 수 없음 |
| `"This file cannot be modified: present in egg denylist."` | Egg 거부 목록의 파일 |
| `"Cannot perform that action: file is a directory."` | 디렉토리에 파일 전용 작업 시도 |
| `"There is not enough disk space available to perform that action."` | 디스크 공간 부족 |
| `"Cannot perform that action: file name is too long."` | 파일명 길이 초과 |
