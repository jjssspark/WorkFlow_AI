# 기여도 점수/학점 공개 시 학생 알림

## 배경

심사자는 기여도 분석 화면(`ContributorsView.tsx`)에서 학생별로 "기여도 점수 공개"와
"학점(총합) 공개" 두 토글을 각각 독립적으로 켜고 끌 수 있다. 이 토글은
`evaluation_scores` 테이블의 `contribution_public`/`final_public` 컬럼에 저장되고,
`POST /api/v1/projects/{projectId}/evaluations` upsert API로 갱신된다(`EvaluationScoreController.upsert`).

문제는 이 API가 값을 저장만 할 뿐, 학생에게 알리지 않는다는 것이다. 학생은 자신의
점수/학점이 공개됐는지 확인하려면 마이페이지에 매번 들어가봐야 한다. 알림 인프라
(`NotificationService`/`NotificationBroadcaster`/SSE 스트림/프론트 종 아이콘 드롭다운)는
이미 업무 배정·완료 승인·마일스톤 등 다른 이벤트에서 쓰이고 있으므로, 이번 작업은
그 인프라에 새 이벤트 두 개를 연결하는 것이다.

## 범위

- 심사자가 **비공개 → 공개**로 전환하는 순간에만 알림을 보낸다. 공개 → 비공개 전환이나,
  이미 공개된 상태를 다시 `true`로 저장하는 호출(다른 필드만 갱신하는 호출 포함)은
  알림을 보내지 않는다.
- 알림 대상은 **해당 학생 한 명**(`EvaluationScore.userId`)뿐이다. 팀 전체 브로드캐스트
  아님(마일스톤 알림과 다른 점).
- "기여도 점수 공개"와 "학점 공개"는 서로 다른 알림 타입으로 별도 발송한다(한 번의
  upsert 호출에 두 필드가 동시에 off→on으로 바뀌면 두 알림이 모두 발송된다).
- 알림은 기존 알림 목록(종 아이콘 드롭다운)에 시간순으로 그대로 섞여서 보인다. 별도
  탭/카테고리 구분 없음.
- 알림 클릭 시 이동 대상은 마이페이지(`/mypage`)로 고정한다. 알림이 가리키는 프로젝트가
  현재 선택된 프로젝트와 다를 경우의 자동 프로젝트 전환은 이번 범위에서 제외한다(대부분
  학생이 프로젝트 1개 소속).
- 실시간 전달 방식은 기존 SSE 인프라를 그대로 재사용한다. 새 인프라 불필요.

## 백엔드 변경

### `EvaluationScoreController.upsert`

플래그를 덮어쓰기 전 값을 저장해뒀다가, 갱신 후 값과 비교해 off→on 전이를 감지한다.
프로젝트 이름을 알림 문구에 넣기 위해 `ProjectRepository`를 새로 주입한다.

```java
public EvaluationScoreController(
    EvaluationScoreRepository evaluationScoreRepository,
    ProjectMemberRepository projectMemberRepository,
    ProjectRepository projectRepository,
    NotificationService notificationService
) { ... }

@PostMapping("/projects/{projectId}/evaluations")
@PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
@Transactional
public ResponseEntity<ApiResponse<EvaluationScoreResponse>> upsert(
    @PathVariable Long projectId,
    @Valid @RequestBody EvaluationScoreRequest request
) {
    // ...기존 멤버 검증...
    EvaluationScore entity = evaluationScoreRepository.findByProjectIdAndUserId(projectId, request.userId())
        .orElseGet(() -> new EvaluationScore(projectId, request.userId(), BigDecimal.ZERO, false));

    boolean wasContributionPublic = entity.isContributionPublic();
    boolean wasFinalPublic = entity.isFinalPublic();

    // ...기존 null-이면-유지 필드 적용 로직 그대로...

    EvaluationScore saved = evaluationScoreRepository.save(entity);

    if (!wasContributionPublic && saved.isContributionPublic()) {
        notifyPublished(saved, "CONTRIBUTION_SCORE_PUBLISHED", "기여도 점수가 공개되었습니다.", "기여도 점수를");
    }
    if (!wasFinalPublic && saved.isFinalPublic()) {
        notifyPublished(saved, "GRADE_PUBLISHED", "학점이 공개되었습니다.", "학점을");
    }

    return ResponseEntity.ok(ApiResponse.ok(EvaluationScoreResponse.from(saved)));
}

private void notifyPublished(EvaluationScore saved, String type, String title, String contentNoun) {
    String projectTitle = projectRepository.findById(saved.getProjectId())
        .map(Project::getTitle)
        .orElse("프로젝트");
    String content = "심사자가 '" + projectTitle + "' 프로젝트의 " + contentNoun + " 공개했습니다.";
    notificationService.notifyAfterCommit(
        saved.getUserId(), type, title, content, "evaluation", saved.getProjectId()
    );
}
```

- `notifyAfterCommit`을 사용하는 이유(기존 주석 그대로 적용): 알림은 부가 기능이라
  트랜잭션 커밋 후에만, 그리고 실패해도 upsert 본 트랜잭션을 막지 않아야 한다.
- `targetType="evaluation"`, `targetId=projectId`로 저장해 프론트가 어느 프로젝트
  건인지 알 수 있게 한다.

### 알림 타입 목록 갱신

`notification` 패키지에는 별도 enum이 없고 문자열 리터럴을 그대로 쓰는 기존 관례를
따른다. 새 타입 두 개:

- `CONTRIBUTION_SCORE_PUBLISHED` — "기여도 점수가 공개되었습니다." / "심사자가 '{프로젝트명}' 프로젝트의 기여도 점수를 공개했습니다."
- `GRADE_PUBLISHED` — "학점이 공개되었습니다." / "심사자가 '{프로젝트명}' 프로젝트의 학점을 공개했습니다."

### 테스트 (`EvaluationScoreControllerTest`)

기존 파일에 `NotificationService`를 Mock으로 추가하고 회귀 테스트 패턴 그대로 추가:

- `upsertSendsContributionScorePublishedNotificationWhenTogglingOffToOn`
- `upsertSendsGradePublishedNotificationWhenTogglingFinalPublicOffToOn`
- `upsertDoesNotSendNotificationWhenAlreadyPublicAndSavedAgain` (중복 발송 방지 회귀)
- `upsertDoesNotSendNotificationWhenTogglingOnToOff` (역방향 전이 시 무알림)
- `upsertSendsBothNotificationsWhenContributionAndFinalBothToggleOnInOneCall`

각 테스트는 `verify(notificationService).notifyAfterCommit(eq(userId), eq(type), any(), any(), eq("evaluation"), eq(projectId))` 형태로 호출 여부/횟수를 검증한다.

## 프론트엔드 변경

### `Header.tsx` (알림 드롭다운)

- 백엔드가 이미 완성된 문장(title/content)을 내려주므로 목록 렌더링 자체는 수정 불필요.
- "바로가기" 버튼 분기(`isActionRequired && n.targetType === "meeting"`)에
  `n.targetType === "evaluation"` 케이스를 추가해 `/mypage`로 이동하는 버튼을 붙인다.
  단, 이 두 알림 타입은 `ACTION_REQUIRED_NOTIFICATION_TYPES`(할일 배지 대상)에는
  포함하지 않는다 — "확인이 필요한 미처리 작업"이 아니라 "정보 전달성 알림"이므로,
  기존 배지 의미(아직 처리 안 한 일)와 섞이지 않게 분리한다. 대신 항상 "바로가기"
  버튼은 보여준다(액션 배지 여부와 무관하게).

```tsx
{n.targetType === "evaluation" && n.targetId && (
  <button
    onClick={() => { setNotifOpen(false); navigate("/mypage"); }}
    className="mt-1.5 px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
  >
    바로가기
  </button>
)}
```

### `notificationApi.ts`

- `NotificationResponse` 타입/`subscribeNotificationStream` 파싱 로직은 이미 임의의
  `type` 문자열을 그대로 통과시키므로 수정 불필요.

## 에러 처리

- 알림 발송 실패는 upsert API 성공 여부에 영향을 주지 않는다(`notifyAfterCommit`의
  기존 격리 정책 그대로: 실패 시 로그만 남기고 조용히 무시).

## 테스트 계획

- 백엔드: 위 5개 케이스를 `EvaluationScoreControllerTest`에 추가.
- 프론트: `Header.test.tsx`(또는 해당 컴포넌트 테스트 파일)에 "targetType이
  evaluation인 알림에 바로가기 버튼이 렌더링되고 클릭 시 /mypage로 navigate된다" 케이스
  추가.
