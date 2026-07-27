# 평가 확정 상태 토글 (evalStatus PUBLISHED ↔ EVALUATING)

## 배경

심사자가 기여도 분석 화면(`ContributorsView.tsx`)에서 "평가 확정" 버튼을 누르면
`POST /projects/{id}/finalize-evaluation`이 호출되어 프로젝트의 `evalStatus`가
`EVALUATING`(평가 중)에서 `PUBLISHED`(공개 완료)로 전이된다. 이 전이는
편도(one-way)로만 구현되어 있어, 확정 후에는 버튼이 비활성화되고 되돌릴
방법이 없다. 실수로 확정했거나 재검토가 필요한 경우에도 상태를 되돌릴 수
없는 것이 문제.

`evalStatus`는 `PENDING`(평가 전) / `EVALUATING`(평가 중) / `DONE`(미사용) /
`PUBLISHED`(공개 완료) 4개 값을 갖지만, 실제 애플리케이션에서 전이가
일어나는 지점은 생성 시 기본값 `PENDING`과 `finalizeEvaluation`이 설정하는
`PUBLISHED` 두 곳뿐이다. `DONE`은 어디에서도 설정되지 않는 미사용 값이며
이번 작업 범위에 포함하지 않는다.

## 범위

- `PUBLISHED` 상태를 `EVALUATING`으로 되돌리는 대칭 동작을 추가한다.
- 단일 상태(evalStatus)를 켜고 끄는 토글 하나로 구현한다. "평가 완료"
  배지(버튼 라벨)와 "공개 완료"(제목 옆 상태 배지)는 이미 같은
  `evalStatus` 값에서 파생되므로 별도로 다룰 필요가 없다.
- 팀원별 개별 공개 여부(`finalPublic`/`contributionPublic`/`commentPublic`,
  `evaluation_scores` 테이블)는 이 토글의 영향을 받지 않는다. "평가 확정
  취소"를 눌러도 이미 공개 처리된 개별 팀원 점수는 자동으로 비공개
  전환되지 않는다 — 상단 상태 배지/버튼만 되돌린다.
- 프로젝트 목록 화면(`ProjectEntryScreen.tsx`, 심사자 홈 `/projects`)의
  "배정"/"평가 중"/"공개 완료" 카운트와 프로젝트 카드의 상태 배지는 이미
  `listProjects()`가 반환하는 실제 `project.evalStatus`에서 파생되어
  있으므로(`resolveEvalStatus`, `EVAL_STATUS_META`) 별도 코드 변경이
  필요 없다. `/contributors`에서 토글 후 `/projects`로 돌아오면
  `useEffect`가 재마운트되며 다시 `listProjects()`를 호출해 최신 값을
  보여준다. 같은 브라우저 탭을 이동하지 않고 값이 실시간으로 바뀌는
  것까지는 이번 범위에 포함하지 않는다(폴링/이벤트 기반 재조회는
  별도 작업).

## 백엔드 변경

### `ProjectService`

`finalizeEvaluation`과 대칭되는 메서드 추가:

```java
/**
 * 심사자가 "평가 확정"을 취소할 때 호출한다. eval_status를 EVALUATING으로
 * 되돌린다. finalizeEvaluation과 마찬가지로 현재 상태를 검사하지 않고
 * 무조건 전이시킨다 — 잠금 기능이 아닌 단순 진행 상태 표시이므로.
 */
@Transactional
public ProjectResponse unfinalizeEvaluation(Long projectId) {
    Project project = getProjectOrThrow(projectId);
    project.setEvalStatus(EvalStatus.EVALUATING);
    return toResponse(project);
}
```

### `ProjectController`

```java
@Operation(
    summary = "평가 확정 취소",
    description = "프로젝트 평가 진행 상태(eval_status)를 EVALUATING으로 되돌린다. "
        + "심사자만 가능하다. 팀원별 평가 점수/공개 여부는 변경하지 않는다."
)
@PostMapping("/{projectId}/unfinalize-evaluation")
@PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
public ApiResponse<ProjectResponse> unfinalizeEvaluation(@PathVariable Long projectId) {
    return ApiResponse.ok(projectService.unfinalizeEvaluation(projectId));
}
```

### 테스트

기존 `ProjectServiceTest`/`ProjectControllerSecurityTest`의 `finalizeEvaluation`
테스트 구조를 그대로 따라 대칭 케이스 추가:

- `ProjectServiceTest`: `unfinalizeEvaluation_setsEvalStatusToEvaluating`,
  `unfinalizeEvaluation_projectNotFound_throws`
- `ProjectControllerSecurityTest`: `unfinalizeEvaluationReturns403WhenCallerIsNotReviewer`

## 프론트엔드 변경

### `projectsApi.ts`

`finalizeEvaluation`과 대칭되는 함수 추가:

```ts
// 심사자가 기여도 분석 화면에서 "평가 확정 취소"를 누를 때 호출한다.
// 프로젝트의 eval_status를 EVALUATING으로 되돌린다(REVIEWER 권한 필요).
export function unfinalizeEvaluation(projectId: number) {
  return apiFetch<ProjectResponse>(`/projects/${projectId}/unfinalize-evaluation`, {
    method: "POST",
  });
}
```

### `ContributorsView.tsx`

- `finalizeEvaluation`/`unfinalizeEvaluation`을 모두 import.
- `handleFinalizeEvaluation`을 `isPublished` 값에 따라 분기하도록 수정(또는
  `handleToggleFinalize`로 이름 변경): `isPublished`가 `true`이면
  `window.confirm(...)`으로 확인 후 `unfinalizeEvaluation` 호출, `false`이면
  기존처럼 `finalizeEvaluation` 호출. 기존 `isFinalizing`/`finalizeError`
  state를 그대로 재사용.
- 확인 문구: `"평가 확정을 취소하면 팀원에게 노출된 점수가 다시 비공개
  상태로 표시됩니다. 취소할까요?"`
- 버튼 렌더링을 상태에 따라 분기:
  - `EVALUATING`(미확정): 기존과 동일 — 파란 배경, `CheckCircle2` 아이콘,
    "평가 확정" / "확정 중..." 라벨. `disabled` 조건에서 `isPublished`
    제거(더 이상 항상 비활성화하지 않음).
  - `PUBLISHED`(확정됨): 회색 테두리 버튼(`border border-border bg-card`
    스타일, 다른 보조 버튼들과 동일 톤), `RotateCcw` 아이콘(lucide-react),
    "평가 확정 취소" / "취소 중..." 라벨.
- 상단 제목 옆 `statusMeta` 배지("평가 중"/"공개 완료")는 `project.evalStatus`
  에서 그대로 파생되므로 수정 불필요 — 토글 결과가 즉시 반영된다.

### `ProjectEntryScreen.tsx` (프로젝트 목록/심사자 홈)

코드 변경 없음. "배정"/"평가 중"/"공개 완료" 카운트와 프로젝트 카드
배지가 이미 실제 `project.evalStatus`(`listProjects()` 응답)에서
파생되므로, `ContributorsView`에서 상태를 토글한 뒤 이 화면으로
돌아오면(라우트 재마운트로 `useEffect`가 다시 실행되며) 자동으로
최신 값이 반영된다.

## 에러 처리

- 취소 실패 시 기존 `finalizeError`에 `"평가 확정 취소에 실패했습니다."`를
  설정(성공 시 액션에 따라 에러 메시지를 다르게 표시).

## 테스트 계획

- 백엔드: `ProjectServiceTest`, `ProjectControllerSecurityTest`에 대칭
  케이스 추가(위 명시).
- 프론트: `ContributorsView.test.tsx`에 다음 케이스 추가
  - `PUBLISHED` 상태일 때 "평가 확정 취소" 버튼이 보이고 클릭 시 확인
    다이얼로그가 뜬다.
  - 확인 후 `unfinalizeEvaluation` 호출, 성공 시 배지가 "평가 중"으로
    바뀐다.
  - 확인 다이얼로그에서 취소하면 API가 호출되지 않는다.
- 프로젝트 목록 화면은 별도 테스트 추가 없음(기존 `resolveEvalStatus`
  파생 로직을 그대로 사용하므로 회귀 없음).
