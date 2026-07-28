# 완료 승인 요청 알림 바로가기 개선 결과

## 변경 목적

팀장에게 도착한 `COMPLETION_REQUESTED` 알림의 `바로가기` 버튼을 누르면 팀장 페이지의 `완료승인 대기`로 이동하고, 알림이 가리키는 업무를 즉시 확인할 수 있게 한다.

## 구현 결과

- 알림 유형별 이동 경로를 `notificationShortcutPath`로 통합했다.
- 완료 승인 요청 알림을 액션 필요 유형으로 등록해 `할 일` 배지와 `바로가기` 버튼을 노출했다.
- 헤더 알림과 실시간 토스트 모두 `/leader/completion-approvals?taskId={업무 ID}`로 이동한다.
- 완료승인 대기 화면은 `taskId`를 읽어 목록 로딩 후 해당 행을 선택하고 상세 패널을 자동으로 연다.
- 회의록 및 평가 알림의 기존 바로가기 동작은 유지했다.

## 검증

- 집중 테스트: 3개 파일, 31개 테스트 통과
- 프로덕션 빌드: 성공
- Vite 대형 청크 경고는 기존 번들 크기에 관한 비차단 경고이며 이번 기능의 실패는 아니다.

## 산출물

- 계획 노트북: `document_Codex/02_completion_approval_notification_shortcut.ipynb`
- 진행 그래프: `output/notification-shortcut/progress.svg`
