# 업무 생성/수정/삭제 권한 팀장 전용 통일

- 날짜: 2026-07-27
- 대상 브랜치: `feature/fs3_ml-delay-risk`
- 이전 결정: [2026-07-26-fs3-schema-api-rollout.md](2026-07-26-fs3-schema-api-rollout.md) — 당시에는 구버전 클라이언트
  호환성을 이유로 업무 생성을 프로젝트 구성원에게 허용했다.

## 재결정 내용

업무(Task)의 생성·수정·삭제를 모두 팀장(LEADER) 전용으로 통일한다.

| 동작 | API | 권한 |
|---|---|---|
| 생성 | `POST /api/v1/projects/{projectId}/tasks` | `hasRole('LEADER')` (변경: 기존 `isMember`) |
| 수정 | `PATCH /api/v1/projects/{projectId}/tasks/{taskId}` | `hasRole('LEADER')` (기존과 동일) |
| 삭제 | `DELETE /api/v1/projects/{projectId}/tasks/{taskId}` | `hasRole('LEADER')` (기존과 동일) |

프론트엔드는 이미 업무 보드/대시보드 5개 화면(`BoardToolbar`, `BoardView`, `DashboardView`, `AllTasksPage`,
`BlockersPage`, `InProgressPage`)에서 "새 업무" 버튼을 팀장에게만 노출하고 있었으므로 변경하지 않는다. 이번 변경으로
백엔드 권한이 그 UI 계약을 그대로 따라간다.

## 영향

- 팀원이 업무 생성 API를 직접 호출하면 이제 403(`FORBIDDEN`)을 받는다. 구버전 클라이언트(팀원이 업무를 생성하던
  플로우) 호환성은 더 이상 보장하지 않는다 — 2026-07-26 결정의 명시적 철회.
- `TaskControllerSecurityTest.java`의 `projectMemberCanCreateTaskForLegacyClientCompatibility`(팀원 생성 허용 회귀
  테스트)를 제거하고, `createTaskReturns403WhenNotLeader`/`leaderCanCreateTask`로 교체해 새 정책을 고정한다.
- 로드맵 화면의 마일스톤 하위 "업무 바로 추가"(`RoadmapController`의 별도 엔드포인트, `isMember`)는 이번 결정
  범위 밖이다 — 업무 보드의 일반 업무 생성과는 다른 화면/계약이라 별도로 재검토가 필요하면 그때 다룬다.
