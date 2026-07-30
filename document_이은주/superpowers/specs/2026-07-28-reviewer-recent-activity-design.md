# 심사자 홈 "최근 심사 활동" 실제 연동

## 배경

심사자 홈(`ProjectEntryScreen.tsx`의 `isJudgeHome` 분기)에는 "최근 심사 활동" 위젯이 있는데,
지금은 `global/lib/mock/reviewer.ts`의 `REVIEWER_ACTIVITIES` 하드코딩 배열을 그대로 보여준다.
실제 심사 액션(기여 점수 공개, 학점 공개, 심사 코멘트 작성, 평가 확정/취소)과는 전혀
연결되어 있지 않다.

프로젝트에는 이미 `activities` 테이블과 `Activity`/`ActivityService`/`ActivityRepository`
인프라가 있고(`App/backend_spring/src/main/java/com/workflowai/activity/`),
`RoadmapService`/`TaskController`/`ChecklistController`가 업무 변경 시 이걸 기록해
프로젝트 대시보드 "최근 활동" 위젯(`ActivityPage.tsx`)에 노출한다. 이번 작업은 심사
액션 4종을 같은 인프라에 기록하고, 심사자 홈 위젯을 실제 데이터로 교체한다.

## 범위

기록 대상 액션 (모두 양방향 전환 포함):

1. 기여 점수 공개/비공개 전환 (`EvaluationScore.contributionPublic` false↔true)
2. 학점(총합) 공개/비공개 전환 (`EvaluationScore.finalPublic` false↔true)
3. 심사 코멘트 저장 (저장할 때마다, 수정 포함)
4. 프로젝트 평가 확정/확정 취소 (`Project.evalStatus` EVALUATING↔PUBLISHED)

- 코멘트 활동만 팀원 이름을 메시지에 포함한다 ("김민준님에 대한 심사 코멘트를
  작성했습니다."). 나머지 3개는 팀명(프로젝트명)만으로 표시한다.
- 기존 `activities` 테이블을 그대로 재사용한다 — 새 테이블 없음. 따라서 이 활동들은
  프로젝트 대시보드의 기존 "최근 활동" 위젯(팀장/팀원이 보는 화면)에도 함께 노출된다.
  이는 의도된 부수 효과다(투명성 — 학생도 심사자가 뭘 했는지 타임라인에서 볼 수 있음).
- 새 조회 API `GET /api/v1/me/reviewer-activities`를 `ReviewerController`에 추가한다.
  현재 로그인한 사용자가 actor인, 위 4종 활동만 최신순 상위 10건을 반환한다(기존
  `/api/v1/me/reviewer-projects`와 같은 패턴 — 심사자가 여러 프로젝트에 걸쳐 한 일을
  한 번에 모아 조회).
- 프론트 심사자 홈 위젯은 이 새 API로 교체하고, `REVIEWER_ACTIVITIES` 목업 사용을
  제거한다.
- 프로젝트 대시보드 활동 타임라인(`activityDisplay.ts`)이 새 4개 타입을 알아야
  "업무 수정"으로 오분류되지 않는다. 아이콘/라벨을 추가한다.

## 백엔드 변경

### `Activity` 엔티티/기존 인프라 재사용

`Activity.targetId`는 지금 업무(task) id 전용으로 문서화되어 있는데, 이번 4개 타입은
평가 대상 학생의 `userId`를 담는다(단, `EVALUATION_FINALIZED`/`_UNFINALIZED`는 특정
학생 대상이 아니므로 `targetId=null`). 클래스 주석을 이 확장에 맞게 갱신한다.

### `ActivityRepository`에 조회 메서드 추가

```java
List<Activity> findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(Long actorId, List<String> types);
```

### `EvaluationScoreController.upsert`

기존에 off→on 알림 발송 로직이 이미 있는 지점에 `activityService.record(...)` 호출을
추가한다. `ActivityService`, `UserRepository`(학생 이름 조회)를 새로 주입한다.

- `contributionPublic`: false→true는 `CONTRIBUTION_SCORE_PUBLISHED`, true→false는
  `CONTRIBUTION_SCORE_UNPUBLISHED`.
- `finalPublic`: false→true는 `GRADE_PUBLISHED`, true→false는 `GRADE_UNPUBLISHED`.
  (이 두 타입명은 기존 알림 타입 `CONTRIBUTION_SCORE_PUBLISHED`/`GRADE_PUBLISHED`와
  동일한 문자열을 그대로 활동 타입에도 재사용한다 — 의미가 같으므로 새 이름을 만들지
  않는다. `_UNPUBLISHED`만 활동 전용으로 신설.)
- `comment`가 요청에 포함(`!= null`)될 때마다 `REVIEW_COMMENT_SAVED` 기록 — 값이
  이전과 동일해도 저장 자체가 액션이므로 항상 기록한다(스펙 확정: 저장할 때마다).
- `targetId`는 `request.userId()`(평가 대상 학생).

### `ProjectController` / `ProjectService`

`finalizeEvaluation`/`unfinalizeEvaluation`에 `activityService.record(...)`를 추가한다.
`ProjectService`에 `ActivityService`를 새로 주입한다. actor는 `CurrentUser.id()` —
현재 `ProjectService`는 `CurrentUser`를 쓰지 않으므로, 컨트롤러에서 `CurrentUser.id()`를
읽어 서비스 메서드에 파라미터로 넘긴다(서비스 계층이 보안 컨텍스트에 직접 의존하지
않는 기존 관례 유지).

```java
// ProjectController
@PostMapping("/{projectId}/finalize-evaluation")
public ApiResponse<ProjectResponse> finalizeEvaluation(@PathVariable Long projectId) {
    return ApiResponse.ok(projectService.finalizeEvaluation(projectId, CurrentUser.id()));
}

@PostMapping("/{projectId}/unfinalize-evaluation")
public ApiResponse<ProjectResponse> unfinalizeEvaluation(@PathVariable Long projectId) {
    return ApiResponse.ok(projectService.unfinalizeEvaluation(projectId, CurrentUser.id()));
}
```

```java
// ProjectService
@Transactional
public ProjectResponse finalizeEvaluation(Long projectId, Long actorId) {
    Project project = getProjectOrThrow(projectId);
    project.setEvalStatus(EvalStatus.PUBLISHED);
    activityService.record(projectId, actorId, "EVALUATION_FINALIZED", null, "프로젝트 평가를 확정했습니다.");
    return toResponse(project);
}

@Transactional
public ProjectResponse unfinalizeEvaluation(Long projectId, Long actorId) {
    Project project = getProjectOrThrow(projectId);
    project.setEvalStatus(EvalStatus.EVALUATING);
    activityService.record(projectId, actorId, "EVALUATION_UNFINALIZED", null, "프로젝트 평가 확정을 취소했습니다.");
    return toResponse(project);
}
```

### 신규: `ReviewerController` GET `/api/v1/me/reviewer-activities`

```java
@GetMapping("/activities")
public ApiResponse<List<ReviewerActivityDto>> myRecentActivities() {
    return ApiResponse.ok(reviewerService.getMyRecentActivities(CurrentUser.id()));
}
```

`ReviewerService.getMyRecentActivities(Long actorId)`가 다음 4개(양방향 포함하면
문자열 상수 6개)를 타입 필터로 조회 후 프로젝트 제목을 배치로 붙여 반환한다:

```
CONTRIBUTION_SCORE_PUBLISHED, CONTRIBUTION_SCORE_UNPUBLISHED,
GRADE_PUBLISHED, GRADE_UNPUBLISHED,
REVIEW_COMMENT_SAVED,
EVALUATION_FINALIZED, EVALUATION_UNFINALIZED
```

응답 DTO:

```java
public record ReviewerActivityDto(
    String id,
    String projectTitle,
    String message,
    String createdAt // ISO-8601 UTC, UtcTimeFormat.toIsoUtc 재사용
) {}
```

## 프론트엔드 변경

### `global/api/reviewerActivityApi.ts` (신규)

```typescript
export interface ReviewerActivityDto {
  id: string;
  projectTitle: string;
  message: string;
  createdAt: string;
}

export function fetchReviewerActivities(): Promise<ReviewerActivityDto[]> {
  return apiFetch<ReviewerActivityDto[]>("/me/reviewer-activities");
}
```

### `ProjectEntryScreen.tsx`

- `REVIEWER_ACTIVITIES` import 제거.
- `isJudgeHome`일 때 `assignedProjects`와 동일한 패턴으로 `useEffect` +
  `fetchReviewerActivities()` 호출, 실패 시 빈 배열 폴백.
- "최근 심사 활동" 섹션 렌더링을 API 응답 필드(`projectTitle`, `message`, `createdAt`)로
  교체. `createdAt`(ISO)을 `MM.DD` 형식으로 변환하는 로컬 헬퍼 함수 추가.
- 목록이 비었을 때 "아직 심사 활동이 없습니다." 안내 문구 표시.

### `global/lib/mock/reviewer.ts`

`REVIEWER_ACTIVITIES` 상수와 관련 주석 제거(`REVIEWER_TEAMS`는 이번 범위 밖 —
사용처 없어도 그대로 둔다).

### `dashboard/libs/utils/activityDisplay.ts`

`DashboardActivityType`에 7개 타입 추가, `KNOWN_ACTIVITY_TYPES`/`activityTypeLabel`/
`ACTIVITY_ICONS`에 각각 라벨·아이콘 매핑을 추가한다:

| 타입 | 라벨 | 아이콘 |
| --- | --- | --- |
| `CONTRIBUTION_SCORE_PUBLISHED` | 기여 점수 공개 | `Eye` |
| `CONTRIBUTION_SCORE_UNPUBLISHED` | 기여 점수 비공개 전환 | `EyeOff` |
| `GRADE_PUBLISHED` | 학점 공개 | `Eye` |
| `GRADE_UNPUBLISHED` | 학점 비공개 전환 | `EyeOff` |
| `REVIEW_COMMENT_SAVED` | 심사 코멘트 작성 | `MessageSquare` |
| `EVALUATION_FINALIZED` | 평가 확정 | `CheckCircle2` |
| `EVALUATION_UNFINALIZED` | 평가 확정 취소 | `Undo2` |

`ActivityPage.tsx`의 `TYPE_FILTERS`에 "심사 활동" 필터를 추가해 이 7개 타입이 필터링
시 사라지지 않게 한다.

## 에러 처리

- `fetchReviewerActivities()` 실패 시 다른 위젯과 동일하게 조용히 빈 배열로 폴백
  (화면 깨짐 없음, 별도 에러 배너 없음 — 기존 `assignedProjectsError`와 달리 이
  위젯은 부가 정보성이라 실패해도 "활동 없음"으로만 보이면 충분).

## 테스트 범위

- 백엔드: `EvaluationScoreControllerTest`에 4개 활동 기록 케이스(공개/비공개 전환
  각 2개, 코멘트 저장, 이미 공개 상태 재저장 시 미기록) 추가. `ProjectServiceTest`에
  확정/취소 활동 기록 케이스 추가. `ReviewerControllerTest`/`ReviewerServiceTest`에
  신규 엔드포인트 케이스 추가.
- 프론트: `activityDisplay.ts`는 순수 함수라 단위 테스트 대상이지만 기존에 테스트
  파일이 없으므로 이번에도 신설하지 않는다(기존 관례 유지, YAGNI). `ProjectEntryScreen`은
  기존에도 테스트 파일이 없어 이번에도 신설하지 않는다.
