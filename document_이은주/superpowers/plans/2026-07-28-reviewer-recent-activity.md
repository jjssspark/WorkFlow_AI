# 심사자 홈 "최근 심사 활동" 실제 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 심사자 홈(`ProjectEntryScreen.tsx`)의 "최근 심사 활동" 위젯을 하드코딩 목업 대신,
기여 점수/학점 공개 전환·심사 코멘트 저장·평가 확정/취소 4종 실제 액션을 반영한 실데이터로 교체한다.

**Architecture:** 기존 `Activity`/`ActivityService`/`activities` 테이블 인프라(이미 `TaskController`
등이 씀)를 재사용해 4종 액션 발생 지점(`EvaluationScoreController.upsert`,
`ProjectService.finalizeEvaluation`/`unfinalizeEvaluation`)에서 활동을 기록한다. 새 조회 API
`GET /api/v1/me/reviewer-activities`를 기존 `ReviewerController`(심사자 전용 마이페이지 API)에
추가해 로그인한 심사자가 남긴 최근 활동만 최신순으로 모아 반환한다. 프론트는 이 API로 위젯을
교체하고, 이 활동들이 재사용하는 `activities` 테이블 덕분에 프로젝트 대시보드 "최근 활동"
타임라인에도 자동 노출되므로 그쪽의 타입-라벨 매핑도 함께 갱신한다.

**Tech Stack:** Spring Boot(Java 21) + JPA + Mockito/MockMvc(백엔드 테스트), React 19 + TypeScript(프론트, 이 화면은 기존에도 테스트 파일 없음 — 신설하지 않음)

## Global Constraints

- 기록 대상 액션은 정확히 4종(양방향 포함 문자열 상수 7개): `CONTRIBUTION_SCORE_PUBLISHED`/`CONTRIBUTION_SCORE_UNPUBLISHED`, `GRADE_PUBLISHED`/`GRADE_UNPUBLISHED`, `REVIEW_COMMENT_SAVED`, `EVALUATION_FINALIZED`/`EVALUATION_UNFINALIZED`.
- 코멘트 활동만 메시지에 대상 학생 이름을 포함한다. 나머지는 팀명(프로젝트명)만.
- 코멘트는 저장 호출마다(값이 이전과 같아도) 기록한다.
- 공개 플래그 전환은 off→on/on→off 양방향 모두 기록한다.
- 새 테이블을 만들지 않는다 — 기존 `activities` 테이블/`Activity`/`ActivityService`를 그대로 쓴다.
- 새 조회 API는 `ReviewerController`에 추가한다(`ActivityController`가 아님).
- 조회 API 실패 시 프론트는 조용히 빈 배열로 폴백한다(에러 배너 없음).
- 백엔드 계층 규칙(`convention/backend.md`): Controller는 얇게, 비즈니스 로직은 Service. `@PreAuthorize`로 권한 검증. Entity 직접 노출 금지(DTO 변환).
- 프론트 컨벤션(`convention/frontend.md`): API 호출은 `libs/`(또는 `global/api/`)에 모으고 컴포넌트에서 직접 fetch 금지.

---

## Task 1: 백엔드 — `ActivityRepository`에 actor 기준 조회 메서드 추가

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/activity/ActivityRepository.java`
- Modify: `App/backend_spring/src/main/java/com/workflowai/activity/Activity.java` (클래스 주석만 갱신)

**Interfaces:**
- Produces: `ActivityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(Long actorId, List<String> types)` → `List<Activity>` — Task 4에서 `ReviewerService`가 사용.

이 리포지토리 메서드는 Spring Data 쿼리 메서드라 별도 유닛 테스트 없이(기존 리포지토리
메서드들도 동일 관례) Task 4의 서비스 테스트로 간접 검증한다.

- [ ] **Step 1: `ActivityRepository`에 메서드 추가**

`App/backend_spring/src/main/java/com/workflowai/activity/ActivityRepository.java`을 다음으로 교체:

```java
package com.workflowai.activity;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ActivityRepository extends JpaRepository<Activity, Long> {
    List<Activity> findTop10ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findTop50ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findByTargetIdOrderByCreatedAtDesc(Long targetId);

    List<Activity> findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(Long actorId, List<String> types);
}
```

- [ ] **Step 2: `Activity.java` 클래스 주석 갱신**

`App/backend_spring/src/main/java/com/workflowai/activity/Activity.java:11`의 주석을 다음으로 교체:

```java
/**
 * 프로젝트 활동 로그. target_id는 폴리모픽(FK 없음) - 업무(task) id 또는
 * 평가 대상 학생의 user id로 쓴다(EVALUATION_FINALIZED/UNFINALIZED는 특정 학생
 * 대상이 아니므로 null).
 */
```

- [ ] **Step 3: 빌드 확인**

Run (Windows, 프로젝트 루트에서):
```
cd App/backend_spring && ./gradlew.bat compileJava 2>&1 | tail -40
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/backend_spring/src/main/java/com/workflowai/activity/ActivityRepository.java App/backend_spring/src/main/java/com/workflowai/activity/Activity.java
git commit -m "feat: ActivityRepository에 actor 기준 활동 조회 메서드 추가"
```

---

## Task 2: 백엔드 — `EvaluationScoreController`에서 공개 토글/코멘트 활동 기록

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/evaluation/EvaluationScoreController.java`
- Test: `App/backend_spring/src/test/java/com/workflowai/evaluation/EvaluationScoreControllerTest.java`

**Interfaces:**
- Consumes: `ActivityService.record(Long projectId, Long actorId, String type, Long targetId, String message)` (기존 `App/backend_spring/src/main/java/com/workflowai/activity/ActivityService.java:14`, 시그니처 변경 없음), `UserRepository.findById(Long)` → `Optional<User>` (기존 JpaRepository 상속), `User.getName()` (기존).
- Produces: `EvaluationScoreController` 생성자가 `ActivityService`, `UserRepository`를 추가로 받아 인자 6개가 된다 — 이 컨트롤러를 인스턴스화하는 다른 코드(테스트)는 생성자 인자를 맞춰야 한다.

### Step 1: 실패하는 테스트부터 작성 — 공개 토글/코멘트 활동 기록

`recordEvaluationActivities`(다음 스텝에서 추가할 프로덕션 코드)는 `CurrentUser.id()`로
행위자를 읽는다. `CurrentUser.id()`는 `SecurityContextHolder`에서 인증 정보를 읽으므로,
standalone MockMvc로 이 경로를 테스트하려면 먼저 인증 컨텍스트를 채워둬야 한다(안 그러면
`IllegalStateException`). 기존 `EvaluationScoreControllerTest`는 이 경로를 타지 않는
테스트뿐이라 지금까지 문제가 없었다.

`EvaluationScoreControllerTest.java` 상단 import에 추가:

```java
import com.workflowai.activity.ActivityService;
import com.workflowai.security.UserPrincipal;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
```

(`java.util.List`는 이미 import되어 있다.)

클래스 필드에 추가:

```java
private static final Long CURRENT_REVIEWER_ID = 9L;

@Mock
private ActivityService activityService;

@Mock
private UserRepository userRepository;

@BeforeEach
void authenticateAsCurrentReviewer() {
    UserPrincipal principal = new UserPrincipal(CURRENT_REVIEWER_ID, "reviewer@example.com", "박현수");
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(principal, null, List.of())
    );
}

@AfterEach
void clearSecurityContext() {
    SecurityContextHolder.clearContext();
}
```

`mockMvc()` 헬퍼를 다음으로 교체:

```java
private MockMvc mockMvc() {
    return MockMvcBuilders
        .standaloneSetup(new EvaluationScoreController(
            evaluationScoreRepository, projectMemberRepository, projectRepository,
            notificationService, activityService, userRepository
        ))
        .setControllerAdvice(new GlobalExceptionHandler())
        .build();
}
```

파일 마지막 테스트(`listReturnsScoreTotalScoreReviewerScoreAndGradeFields`) 앞에 다음 테스트들을 추가한다:

```java
@Test
void upsertRecordsActivityWhenContributionPublicTogglesOffToOn() throws Exception {
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    Project project = new Project("캡스톤디자인 2024", "capstone", "설명");
    when(projectRepository.findById(1L)).thenReturn(Optional.of(project));
    User student = new User("kim@example.com", "김민준", "local", "kim");
    when(userRepository.findById(3L)).thenReturn(Optional.of(student));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, true, null, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(activityService).record(
        eq(1L), eq(CURRENT_REVIEWER_ID), eq("CONTRIBUTION_SCORE_PUBLISHED"), eq(3L),
        eq("김민준님의 기여 점수를 공개했습니다.")
    );
}

@Test
void upsertRecordsActivityWhenContributionPublicTogglesOnToOff() throws Exception {
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), true);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    User student = new User("kim@example.com", "김민준", "local", "kim");
    when(userRepository.findById(3L)).thenReturn(Optional.of(student));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, false, null, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(activityService).record(
        eq(1L), eq(CURRENT_REVIEWER_ID), eq("CONTRIBUTION_SCORE_UNPUBLISHED"), eq(3L),
        eq("김민준님의 기여 점수를 비공개로 전환했습니다.")
    );
}

@Test
void upsertRecordsActivityWhenFinalPublicTogglesOffToOn() throws Exception {
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    Project project = new Project("캡스톤디자인 2024", "capstone", "설명");
    when(projectRepository.findById(1L)).thenReturn(Optional.of(project));
    User student = new User("kim@example.com", "김민준", "local", "kim");
    when(userRepository.findById(3L)).thenReturn(Optional.of(student));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, null, true, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(activityService).record(
        eq(1L), eq(CURRENT_REVIEWER_ID), eq("GRADE_PUBLISHED"), eq(3L),
        eq("김민준님의 학점을 공개했습니다.")
    );
}

@Test
void upsertRecordsActivityWhenFinalPublicTogglesOnToOff() throws Exception {
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    existing.setFinalPublic(true);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    User student = new User("kim@example.com", "김민준", "local", "kim");
    when(userRepository.findById(3L)).thenReturn(Optional.of(student));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, null, false, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(activityService).record(
        eq(1L), eq(CURRENT_REVIEWER_ID), eq("GRADE_UNPUBLISHED"), eq(3L),
        eq("김민준님의 학점을 비공개로 전환했습니다.")
    );
}

@Test
void upsertRecordsActivityEveryTimeCommentIsSaved() throws Exception {
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    existing.setComment("기존 코멘트");
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    User student = new User("kim@example.com", "김민준", "local", "kim");
    when(userRepository.findById(3L)).thenReturn(Optional.of(student));

    // 값이 기존과 동일해도(재저장) 저장할 때마다 기록해야 한다.
    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, null, null, null, null, null, "기존 코멘트"
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(activityService).record(
        eq(1L), eq(CURRENT_REVIEWER_ID), eq("REVIEW_COMMENT_SAVED"), eq(3L),
        eq("김민준님에 대한 심사 코멘트를 작성했습니다.")
    );
}

@Test
void upsertDoesNotRecordCommentActivityWhenCommentFieldOmitted() throws Exception {
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

    // comment가 null(생략)이면 코멘트 활동을 기록하지 않는다 — 공개 토글만 바뀌는 호출.
    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, null, null, true, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(activityService, never()).record(any(), any(), eq("REVIEW_COMMENT_SAVED"), any(), any());
}
```

- [ ] **Step 2: 테스트 실행 — 컴파일 실패 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.evaluation.EvaluationScoreControllerTest" 2>&1 | tail -60
```
Expected: 컴파일 에러 — `EvaluationScoreController` 생성자가 4개 인자만 받는데 6개 인자로 호출됨, 또는 `ActivityService`/`UserRepository` 미해결 참조.

- [ ] **Step 3: 프로덕션 코드 수정**

`EvaluationScoreController.java` 전체를 다음으로 교체:

```java
package com.workflowai.evaluation;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.ApiResponse;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.security.CurrentUser;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "평가 점수", description = "심사자 최종 평가 점수 확정/공개 및 팀원 본인 조회")
@RestController
@RequestMapping("/api/v1")
public class EvaluationScoreController {
    private final EvaluationScoreRepository evaluationScoreRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final NotificationService notificationService;
    private final ActivityService activityService;
    private final UserRepository userRepository;

    public EvaluationScoreController(
        EvaluationScoreRepository evaluationScoreRepository,
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        NotificationService notificationService,
        ActivityService activityService,
        UserRepository userRepository
    ) {
        this.evaluationScoreRepository = evaluationScoreRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.notificationService = notificationService;
        this.activityService = activityService;
        this.userRepository = userRepository;
    }

    @Operation(
        summary = "팀원 평가 점수 확정/공개 여부 저장",
        description = "심사자가 기여도 분석 화면에서 점수를 확정하거나 공개 여부를 토글할 때 호출한다. "
            + "동일 (project_id, user_id) 조합이 이미 있으면 갱신(upsert)한다. 심사자만 호출 가능하다."
    )
    @PostMapping("/projects/{projectId}/evaluations")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    @Transactional
    public ResponseEntity<ApiResponse<EvaluationScoreResponse>> upsert(
        @PathVariable Long projectId,
        @Valid @RequestBody EvaluationScoreRequest request
    ) {
        if (!projectMemberRepository.existsByProjectIdAndUserId(projectId, request.userId())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.fail("USER_NOT_PROJECT_MEMBER", "해당 사용자는 이 프로젝트의 멤버가 아닙니다."));
        }
        EvaluationScore entity = evaluationScoreRepository.findByProjectIdAndUserId(projectId, request.userId())
            .orElseGet(() -> new EvaluationScore(projectId, request.userId(), BigDecimal.ZERO, false));

        // 공개 플래그를 덮어쓰기 전 값을 기억해뒀다가, 저장 후 값과 비교해 전이 방향에 따라
        // 알림(off→on만)과 활동 기록(양방향 모두)을 각각 다르게 처리한다.
        boolean wasContributionPublic = entity.isContributionPublic();
        boolean wasFinalPublic = entity.isFinalPublic();
        boolean commentProvided = request.comment() != null;

        // score/totalScore/공개 플래그 3종/reviewerScore/grade/comment는 모두 null이면
        // 기존 값을 그대로 유지한다 — 세 공개 플래그(기여 점수/총합·학점/코멘트)는 서로
        // 독립적으로 토글되므로, 한쪽만 토글하는 호출이 다른 두 화면이 저장한 값이나
        // 공개 상태를 덮어쓰면 안 된다. score(AI 기여 점수)와 totalScore(학점 계산기
        // 최종 총합)는 별개 컬럼이므로 학점 계산기 저장은 totalScore만 채운다.
        if (request.score() != null) {
            entity.setScore(request.score());
        }
        if (request.totalScore() != null) {
            entity.setTotalScore(request.totalScore());
        }
        if (request.contributionPublic() != null) {
            entity.setContributionPublic(request.contributionPublic());
        }
        if (request.finalPublic() != null) {
            entity.setFinalPublic(request.finalPublic());
        }
        if (request.commentPublic() != null) {
            entity.setCommentPublic(request.commentPublic());
        }
        if (request.reviewerScore() != null) {
            entity.setReviewerScore(request.reviewerScore());
        }
        if (request.grade() != null) {
            entity.setGrade(request.grade());
        }
        if (request.comment() != null) {
            entity.setComment(request.comment());
        }
        EvaluationScore saved = evaluationScoreRepository.save(entity);

        if (!wasContributionPublic && saved.isContributionPublic()) {
            notifyPublished(saved, "CONTRIBUTION_SCORE_PUBLISHED", "기여도 점수가 공개되었습니다.", "기여도 점수를");
        }
        if (!wasFinalPublic && saved.isFinalPublic()) {
            notifyPublished(saved, "GRADE_PUBLISHED", "학점이 공개되었습니다.", "학점을");
        }

        recordEvaluationActivities(saved, wasContributionPublic, wasFinalPublic, commentProvided);

        return ResponseEntity.ok(ApiResponse.ok(EvaluationScoreResponse.from(saved)));
    }

    /** 기여 점수/학점이 비공개→공개로 바뀐 순간, 해당 학생 본인에게만 알림을 보낸다. */
    private void notifyPublished(EvaluationScore saved, String type, String title, String contentNoun) {
        String projectTitle = projectRepository.findById(saved.getProjectId())
            .map(Project::getTitle)
            .orElse("프로젝트");
        String content = "심사자가 '" + projectTitle + "' 프로젝트의 " + contentNoun + " 공개했습니다.";
        notificationService.notifyAfterCommit(
            saved.getUserId(), type, title, content, "evaluation", saved.getProjectId()
        );
    }

    /**
     * 심사자 홈 "최근 심사 활동" 위젯과 프로젝트 대시보드 "최근 활동" 타임라인에 공통으로
     * 쓰이는 활동 로그. actor는 CurrentUser.id()(심사자 본인) — @PreAuthorize로 이미
     * REVIEWER 역할임이 보장된다. 공개 플래그는 양방향 전이 모두 기록하고(알림은 off→on만),
     * 코멘트는 값이 요청에 포함될 때마다(변경 여부와 무관하게) 기록한다.
     */
    private void recordEvaluationActivities(
        EvaluationScore saved,
        boolean wasContributionPublic,
        boolean wasFinalPublic,
        boolean commentProvided
    ) {
        boolean contributionChanged = wasContributionPublic != saved.isContributionPublic();
        boolean finalChanged = wasFinalPublic != saved.isFinalPublic();
        if (!contributionChanged && !finalChanged && !commentProvided) {
            return;
        }

        Long actorId = CurrentUser.id();
        String studentName = userRepository.findById(saved.getUserId())
            .map(User::getName)
            .orElse("알 수 없는 학생");

        if (contributionChanged) {
            boolean nowPublic = saved.isContributionPublic();
            activityService.record(
                saved.getProjectId(), actorId,
                nowPublic ? "CONTRIBUTION_SCORE_PUBLISHED" : "CONTRIBUTION_SCORE_UNPUBLISHED",
                saved.getUserId(),
                studentName + "님의 기여 점수를 " + (nowPublic ? "공개했습니다." : "비공개로 전환했습니다.")
            );
        }
        if (finalChanged) {
            boolean nowPublic = saved.isFinalPublic();
            activityService.record(
                saved.getProjectId(), actorId,
                nowPublic ? "GRADE_PUBLISHED" : "GRADE_UNPUBLISHED",
                saved.getUserId(),
                studentName + "님의 학점을 " + (nowPublic ? "공개했습니다." : "비공개로 전환했습니다.")
            );
        }
        if (commentProvided) {
            activityService.record(
                saved.getProjectId(), actorId, "REVIEW_COMMENT_SAVED", saved.getUserId(),
                studentName + "님에 대한 심사 코멘트를 작성했습니다."
            );
        }
    }

    @Operation(
        summary = "프로젝트 내 평가 점수 목록 조회",
        description = "심사자 화면에서 현재 공개/비공개 상태를 새로고침 없이 확인할 때 사용한다. 심사자만 호출 가능하다."
    )
    @GetMapping("/projects/{projectId}/evaluations")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    public ApiResponse<List<EvaluationScoreResponse>> list(@PathVariable Long projectId) {
        List<EvaluationScoreResponse> result = evaluationScoreRepository.findAllByProjectId(projectId).stream()
            .map(EvaluationScoreResponse::from)
            .toList();
        return ApiResponse.ok(result);
    }

    @Operation(
        summary = "내 평가 결과 조회 (마이페이지)",
        description = "심사자가 공개 처리한 경우에만 점수를 반환한다. 아직 없거나 비공개면 revealed=false, score=null. "
            + "항상 로그인한 본인 기준으로 조회하며, 이 프로젝트 멤버가 아니면 접근할 수 없다."
    )
    @GetMapping("/projects/{projectId}/evaluations/me")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<MyEvaluationResponse> myEvaluation(@PathVariable Long projectId) {
        Long userId = CurrentUser.id();
        MyEvaluationResponse response = evaluationScoreRepository.findByProjectIdAndUserId(projectId, userId)
            .map(MyEvaluationResponse::from)
            .orElseGet(MyEvaluationResponse::notRevealed);
        return ApiResponse.ok(response);
    }
}
```

`CurrentUser.id()`는 `SecurityContextHolder`에서 인증 정보를 읽는데, 이 컨트롤러의 기존
`myEvaluation` 메서드가 이미 같은 방식으로 쓰고 있으므로 새로 추가되는 위험은 없다.
Step 1에서 이미 `@BeforeEach`로 인증 컨텍스트를 채워뒀으므로 추가 설정은 필요 없다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.evaluation.EvaluationScoreControllerTest" 2>&1 | tail -80
```
Expected: 모든 테스트(기존 12개 + 신규 6개) PASS.

- [ ] **Step 5: 전체 백엔드 테스트 실행 (회귀 확인)**

Run:
```
cd App/backend_spring && ./gradlew.bat test 2>&1 | tail -80
```
Expected: BUILD SUCCESSFUL. `new EvaluationScoreController(...)`를 4-인자로 호출하는 다른 코드가 없는지 확인 — 있다면 함께 고친다.

- [ ] **Step 6: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/backend_spring/src/main/java/com/workflowai/evaluation/EvaluationScoreController.java App/backend_spring/src/test/java/com/workflowai/evaluation/EvaluationScoreControllerTest.java
git commit -m "feat: 기여 점수/학점 공개 전환·심사 코멘트 저장 시 활동 로그 기록"
```

---

## Task 3: 백엔드 — 평가 확정/취소 시 활동 기록

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/project/ProjectService.java`
- Modify: `App/backend_spring/src/main/java/com/workflowai/project/ProjectController.java`
- Test: `App/backend_spring/src/test/java/com/workflowai/project/ProjectServiceTest.java`

**Interfaces:**
- Consumes: `ActivityService.record(Long projectId, Long actorId, String type, Long targetId, String message)` (기존, Task 2와 동일 시그니처).
- Produces: `ProjectService` 생성자가 `ActivityService`를 추가로 받아 인자 8개가 된다. `finalizeEvaluation`/`unfinalizeEvaluation`이 `actorId` 파라미터를 추가로 받는다 — `ProjectController`가 이 시그니처 변경에 맞춰 `CurrentUser.id()`를 전달하도록 함께 수정한다.

### Step 1: 실패하는 테스트부터 작성

`ProjectServiceTest.java` 상단 import에 추가:

```java
import com.workflowai.activity.ActivityService;
import static org.mockito.ArgumentMatchers.eq;
```

(`verify`, `when`, `any`는 이미 import되어 있다.)

클래스 필드에 추가:

```java
@Mock private ActivityService activityService;
```

`setUp()`의 `projectService = new ProjectService(...)` 생성자 호출에 `activityService`를 마지막 인자로 추가:

```java
projectService = new ProjectService(
    projectRepository,
    projectMemberRepository,
    userRepository,
    taskRepository,
    milestoneRepository,
    transactionOperations,
    ragIngestService,
    activityService
);
```

기존 `finalizeEvaluation_setsEvalStatusToPublished` / `finalizeEvaluation_projectNotFound_throws` /
`unfinalizeEvaluation_setsEvalStatusToEvaluating` / `unfinalizeEvaluation_projectNotFound_throws`
4개 테스트의 `projectService.finalizeEvaluation(10L)` / `projectService.finalizeEvaluation(999L)` /
`projectService.unfinalizeEvaluation(10L)` / `projectService.unfinalizeEvaluation(999L)` 호출에
`actorId` 인자 `7L`을 추가한다(예: `projectService.finalizeEvaluation(10L, 7L)`).

같은 파일의 `unfinalizeEvaluation_projectNotFound_throws` 테스트 다음에 새 테스트 2개를 추가한다:

```java
@Test
void finalizeEvaluation_recordsActivity() {
    Project project = new Project("제목", "캡스톤디자인", "설명");
    ReflectionTestUtils.setField(project, "id", 10L);
    ReflectionTestUtils.setField(project, "evalStatus", EvalStatus.EVALUATING);
    when(projectRepository.findById(10L)).thenReturn(Optional.of(project));
    when(projectMemberRepository.countByProjectIdAndRoleNot(10L, ProjectRole.REVIEWER)).thenReturn(2L);
    when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());

    projectService.finalizeEvaluation(10L, 7L);

    verify(activityService).record(
        eq(10L), eq(7L), eq("EVALUATION_FINALIZED"), eq(null), eq("프로젝트 평가를 확정했습니다.")
    );
}

@Test
void unfinalizeEvaluation_recordsActivity() {
    Project project = new Project("제목", "캡스톤디자인", "설명");
    ReflectionTestUtils.setField(project, "id", 10L);
    ReflectionTestUtils.setField(project, "evalStatus", EvalStatus.PUBLISHED);
    when(projectRepository.findById(10L)).thenReturn(Optional.of(project));
    when(projectMemberRepository.countByProjectIdAndRoleNot(10L, ProjectRole.REVIEWER)).thenReturn(2L);
    when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());

    projectService.unfinalizeEvaluation(10L, 7L);

    verify(activityService).record(
        eq(10L), eq(7L), eq("EVALUATION_UNFINALIZED"), eq(null), eq("프로젝트 평가 확정을 취소했습니다.")
    );
}
```

- [ ] **Step 2: 테스트 실행 — 컴파일 실패 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.project.ProjectServiceTest" 2>&1 | tail -60
```
Expected: 컴파일 에러 — `ProjectService` 생성자 인자 수 불일치, 또는 `finalizeEvaluation(Long)`/`unfinalizeEvaluation(Long)` 메서드가 2개 인자 호출과 맞지 않음.

- [ ] **Step 3: `ProjectService.java` 수정**

생성자/필드에 `ActivityService` 추가:

```java
import com.workflowai.activity.ActivityService;
```

```java
private final ActivityService activityService;

public ProjectService(
    ProjectRepository projectRepository,
    ProjectMemberRepository projectMemberRepository,
    UserRepository userRepository,
    TaskRepository taskRepository,
    MilestoneRepository milestoneRepository,
    TransactionOperations transactionOperations,
    RagIngestService ragIngestService,
    ActivityService activityService
) {
    this.projectRepository = projectRepository;
    this.projectMemberRepository = projectMemberRepository;
    this.userRepository = userRepository;
    this.taskRepository = taskRepository;
    this.milestoneRepository = milestoneRepository;
    this.transactionOperations = transactionOperations;
    this.ragIngestService = ragIngestService;
    this.activityService = activityService;
}
```

`finalizeEvaluation`/`unfinalizeEvaluation`을 다음으로 교체(`App/backend_spring/src/main/java/com/workflowai/project/ProjectService.java:264-287` 부근):

```java
/**
 * 심사자가 기여도 분석 화면에서 "평가 확정"을 누를 때 호출한다. eval_status를
 * PUBLISHED로 전이한다. 확정 후에도 팀원별 점수/공개 여부(evaluation_scores)는
 * 계속 수정 가능하다 — 이 필드는 단순 진행 상태 표시용이며 잠금 기능은 아니다.
 * actorId는 심사자 홈 "최근 심사 활동"/대시보드 "최근 활동"에 남길 행위자다.
 */
@Transactional
public ProjectResponse finalizeEvaluation(Long projectId, Long actorId) {
    Project project = getProjectOrThrow(projectId);
    project.setEvalStatus(EvalStatus.PUBLISHED);
    activityService.record(projectId, actorId, "EVALUATION_FINALIZED", null, "프로젝트 평가를 확정했습니다.");
    return toResponse(project);
}

/**
 * 심사자가 "평가 확정"을 취소할 때 호출한다. eval_status를 EVALUATING으로
 * 되돌린다. finalizeEvaluation과 마찬가지로 현재 상태를 검사하지 않고
 * 무조건 전이시킨다 — 잠금 기능이 아닌 단순 진행 상태 표시이므로.
 * 팀원별 점수/공개 여부(evaluation_scores)는 건드리지 않는다.
 */
@Transactional
public ProjectResponse unfinalizeEvaluation(Long projectId, Long actorId) {
    Project project = getProjectOrThrow(projectId);
    project.setEvalStatus(EvalStatus.EVALUATING);
    activityService.record(projectId, actorId, "EVALUATION_UNFINALIZED", null, "프로젝트 평가 확정을 취소했습니다.");
    return toResponse(project);
}
```

- [ ] **Step 4: `ProjectController.java` 수정**

`App/backend_spring/src/main/java/com/workflowai/project/ProjectController.java:98-113`의 두 메서드를 다음으로 교체:

```java
@Operation(
    summary = "평가 확정",
    description = "프로젝트 평가 진행 상태(eval_status)를 PUBLISHED로 전이한다. 심사자만 가능하다. "
        + "확정 후에도 팀원별 평가 점수/공개 여부는 계속 수정할 수 있다(단순 상태 표시용, 잠금 아님)."
)
@PostMapping("/{projectId}/finalize-evaluation")
@PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
public ApiResponse<ProjectResponse> finalizeEvaluation(@PathVariable Long projectId) {
    return ApiResponse.ok(projectService.finalizeEvaluation(projectId, CurrentUser.id()));
}

@Operation(
    summary = "평가 확정 취소",
    description = "프로젝트 평가 진행 상태(eval_status)를 EVALUATING으로 되돌린다. "
        + "심사자만 가능하다. 팀원별 평가 점수/공개 여부는 변경하지 않는다."
)
@PostMapping("/{projectId}/unfinalize-evaluation")
@PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
public ApiResponse<ProjectResponse> unfinalizeEvaluation(@PathVariable Long projectId) {
    return ApiResponse.ok(projectService.unfinalizeEvaluation(projectId, CurrentUser.id()));
}
```

(`CurrentUser`는 이미 `ProjectController.java:4`에서 import되어 있다.)

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.project.ProjectServiceTest" 2>&1 | tail -80
```
Expected: 모든 테스트 PASS.

- [ ] **Step 6: 전체 백엔드 테스트 실행 (회귀 확인)**

Run:
```
cd App/backend_spring && ./gradlew.bat test 2>&1 | tail -100
```
Expected: BUILD SUCCESSFUL. `ProjectControllerSecurityTest` 등 `finalizeEvaluation`/`unfinalizeEvaluation` 경로를 건드리는 다른 테스트가 있다면 함께 통과하는지 확인(있다면 `new ProjectService(...)` 생성자 호출부를 8-인자로 맞춰야 함).

- [ ] **Step 7: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/backend_spring/src/main/java/com/workflowai/project/ProjectService.java App/backend_spring/src/main/java/com/workflowai/project/ProjectController.java App/backend_spring/src/test/java/com/workflowai/project/ProjectServiceTest.java
git commit -m "feat: 평가 확정/확정 취소 시 활동 로그 기록"
```

---

## Task 4: 백엔드 — 심사자 활동 조회 API 추가

**Files:**
- Create: `App/backend_spring/src/main/java/com/workflowai/reviewer/ReviewerActivityDto.java`
- Modify: `App/backend_spring/src/main/java/com/workflowai/reviewer/ReviewerService.java`
- Modify: `App/backend_spring/src/main/java/com/workflowai/reviewer/ReviewerController.java`
- Test: `App/backend_spring/src/test/java/com/workflowai/reviewer/ReviewerServiceTest.java`
- Test: `App/backend_spring/src/test/java/com/workflowai/reviewer/ReviewerControllerTest.java`

**Interfaces:**
- Consumes: `ActivityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(Long actorId, List<String> types)` (Task 1에서 추가), `ProjectRepository.findAllById(Iterable<Long>)` (기존), `Project.getTitle()` (기존), `UtcTimeFormat.toIsoUtc(LocalDateTime)` (기존 `App/backend_spring/src/main/java/com/workflowai/common/UtcTimeFormat.java`).
- Produces: `GET /api/v1/me/reviewer-activities` → `ApiResponse<List<ReviewerActivityDto>>`. `ReviewerService.getMyRecentActivities(Long actorId)` → `List<ReviewerActivityDto>` — Task 5(프론트)가 이 API의 응답 필드(`id`, `projectTitle`, `message`, `createdAt`)를 그대로 소비한다.

### Step 1: `ReviewerActivityDto` 작성

```java
package com.workflowai.reviewer;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "심사자 홈 \"최근 심사 활동\" 위젯용 활동 항목")
public record ReviewerActivityDto(
    @Schema(description = "활동 ID", example = "12") String id,
    @Schema(description = "활동이 발생한 프로젝트명", example = "스마트 주차 관리 시스템") String projectTitle,
    @Schema(description = "화면에 그대로 보여줄 메시지") String message,
    @Schema(description = "발생 시각 (ISO-8601 UTC)") String createdAt
) {}
```

Write: `App/backend_spring/src/main/java/com/workflowai/reviewer/ReviewerActivityDto.java`

- [ ] **Step 2: 실패하는 서비스 테스트 작성**

`ReviewerServiceTest.java` 상단 import에 추가:

```java
import com.workflowai.activity.Activity;
import com.workflowai.activity.ActivityRepository;
import java.time.LocalDateTime;
```

클래스 필드에 추가:

```java
@Mock private ActivityRepository activityRepository;
```

`setUp()`의 생성자 호출에 `activityRepository`를 추가:

```java
reviewerService = new ReviewerService(
    projectMemberRepository, projectRepository, userRepository,
    taskRepository, deliverableRepository, githubRecordRepository, activityRepository
);
```

파일 마지막에 새 테스트 클래스 메서드를 추가한다:

```java
@Test
void getMyRecentActivities_returnsActivitiesWithProjectTitleAttached() {
    Activity activity = new Activity(3L, 9L, "GRADE_PUBLISHED", 20L, "김민준님의 학점을 공개했습니다.");
    ReflectionTestUtils.setField(activity, "id", 100L);
    ReflectionTestUtils.setField(activity, "createdAt", LocalDateTime.of(2026, 7, 28, 10, 0));
    when(activityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(eq(9L), any()))
        .thenReturn(List.of(activity));
    when(projectRepository.findAllById(List.of(3L)))
        .thenReturn(List.of(projectWithId(3L, "실시간 버스 도착 알리미", "캡스톤디자인", EvalStatus.PUBLISHED)));

    List<ReviewerActivityDto> result = reviewerService.getMyRecentActivities(9L);

    assertThat(result).hasSize(1);
    assertThat(result.get(0).id()).isEqualTo("100");
    assertThat(result.get(0).projectTitle()).isEqualTo("실시간 버스 도착 알리미");
    assertThat(result.get(0).message()).isEqualTo("김민준님의 학점을 공개했습니다.");
}

@Test
void getMyRecentActivities_returnsEmptyListWhenNoActivities() {
    when(activityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(eq(9L), any()))
        .thenReturn(List.of());

    List<ReviewerActivityDto> result = reviewerService.getMyRecentActivities(9L);

    assertThat(result).isEmpty();
}
```

`eq`, `any`는 이미 정적 import되어 있다(`import static org.mockito.Mockito.when;`만 있다면
`import static org.mockito.ArgumentMatchers.any;`, `import static org.mockito.ArgumentMatchers.eq;`를
상단에 추가).

- [ ] **Step 3: 테스트 실행 — 컴파일 실패 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.reviewer.ReviewerServiceTest" 2>&1 | tail -60
```
Expected: 컴파일 에러 — `ReviewerService` 생성자 인자 수 불일치, `getMyRecentActivities` 메서드 없음.

- [ ] **Step 4: `ReviewerService.java` 수정**

import 추가:

```java
import com.workflowai.activity.Activity;
import com.workflowai.activity.ActivityRepository;
import com.workflowai.common.UtcTimeFormat;
import java.util.ArrayList;
```

필드/생성자에 `activityRepository` 추가:

```java
private final ActivityRepository activityRepository;

public ReviewerService(
    ProjectMemberRepository projectMemberRepository,
    ProjectRepository projectRepository,
    UserRepository userRepository,
    TaskRepository taskRepository,
    DeliverableRepository deliverableRepository,
    GithubRecordRepository githubRecordRepository,
    ActivityRepository activityRepository
) {
    this.projectMemberRepository = projectMemberRepository;
    this.projectRepository = projectRepository;
    this.userRepository = userRepository;
    this.taskRepository = taskRepository;
    this.deliverableRepository = deliverableRepository;
    this.githubRecordRepository = githubRecordRepository;
    this.activityRepository = activityRepository;
}
```

클래스 상단(`TASK_STATUS_DONE` 근처)에 활동 타입 상수 목록을 추가:

```java
private static final List<String> REVIEWER_ACTIVITY_TYPES = List.of(
    "CONTRIBUTION_SCORE_PUBLISHED", "CONTRIBUTION_SCORE_UNPUBLISHED",
    "GRADE_PUBLISHED", "GRADE_UNPUBLISHED",
    "REVIEW_COMMENT_SAVED",
    "EVALUATION_FINALIZED", "EVALUATION_UNFINALIZED"
);
```

클래스 끝(마지막 메서드 `toSummary` 다음)에 새 메서드를 추가:

```java
/** 심사자 홈 "최근 심사 활동" 위젯 — 로그인한 심사자 본인이 남긴 활동만 최신순 10건. */
public List<ReviewerActivityDto> getMyRecentActivities(Long actorId) {
    List<Activity> activities = activityRepository
        .findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(actorId, REVIEWER_ACTIVITY_TYPES);
    if (activities.isEmpty()) {
        return List.of();
    }

    Map<Long, String> projectTitleById = new HashMap<>();
    projectRepository.findAllById(activities.stream().map(Activity::getProjectId).distinct().toList())
        .forEach(project -> projectTitleById.put(project.getId(), project.getTitle()));

    List<ReviewerActivityDto> result = new ArrayList<>();
    for (Activity activity : activities) {
        result.add(new ReviewerActivityDto(
            String.valueOf(activity.getId()),
            projectTitleById.getOrDefault(activity.getProjectId(), "프로젝트"),
            activity.getMessage(),
            UtcTimeFormat.toIsoUtc(activity.getCreatedAt())
        ));
    }
    return result;
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.reviewer.ReviewerServiceTest" 2>&1 | tail -80
```
Expected: 모든 테스트 PASS.

- [ ] **Step 6: 실패하는 컨트롤러 테스트 작성**

`ReviewerControllerTest.java` 파일 끝에 다음 테스트를 추가한다:

```java
@Test
void myRecentActivitiesReturnsDataFromService() throws Exception {
    ReviewerActivityDto activity = new ReviewerActivityDto(
        "100", "실시간 버스 도착 알리미", "김민준님의 학점을 공개했습니다.", "2026-07-28T01:00:00Z"
    );
    when(reviewerService.getMyRecentActivities(eq(CURRENT_USER_ID))).thenReturn(List.of(activity));

    ReviewerController controller = new ReviewerController(reviewerService);
    MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

    mockMvc.perform(get("/api/v1/me/reviewer-activities"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.success").value(true))
        .andExpect(jsonPath("$.data[0].id").value("100"))
        .andExpect(jsonPath("$.data[0].projectTitle").value("실시간 버스 도착 알리미"))
        .andExpect(jsonPath("$.data[0].message").value("김민준님의 학점을 공개했습니다."));
}

@Test
void myRecentActivitiesReturnsEmptyArrayWhenCallerHasNoActivities() throws Exception {
    when(reviewerService.getMyRecentActivities(eq(CURRENT_USER_ID))).thenReturn(List.of());

    ReviewerController controller = new ReviewerController(reviewerService);
    MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

    mockMvc.perform(get("/api/v1/me/reviewer-activities"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").isArray())
        .andExpect(jsonPath("$.data.length()").value(0));
}
```

- [ ] **Step 7: 테스트 실행 — 컴파일 실패 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.reviewer.ReviewerControllerTest" 2>&1 | tail -60
```
Expected: 컴파일 에러 또는 404 — `/api/v1/me/reviewer-activities` 엔드포인트 없음.

- [ ] **Step 8: `ReviewerController.java`에 엔드포인트 추가**

기존 `@RequestMapping("/api/v1/me/reviewer-projects")`는 클래스 레벨 매핑이라 형제 경로인
`/api/v1/me/reviewer-activities`를 메서드 레벨에서 표현할 수 없다. 클래스 레벨 매핑을
`/api/v1/me`로 올리고, 각 메서드에 전체 하위 경로(`/reviewer-projects`, `/reviewer-activities`)를
명시하도록 파일 전체를 다음으로 교체한다(기존 `GET /api/v1/me/reviewer-projects` 경로는
그대로 유지된다):

```java
package com.workflowai.reviewer;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "심사자", description = "심사자 마이페이지 전용 API")
@RestController
@RequestMapping("/api/v1/me")
public class ReviewerController {
    private final ReviewerService reviewerService;

    public ReviewerController(ReviewerService reviewerService) {
        this.reviewerService = reviewerService;
    }

    @Operation(
        summary = "내가 심사자로 배정된 프로젝트 목록",
        description = "현재 로그인한 사용자가 REVIEWER 역할로 배정된 모든 프로젝트를 반환한다. 심사자가 아니면 빈 배열을 반환한다."
    )
    @GetMapping("/reviewer-projects")
    public ApiResponse<List<ReviewerProjectSummary>> myReviewProjects() {
        return ApiResponse.ok(reviewerService.getMyReviewProjects(CurrentUser.id()));
    }

    @Operation(
        summary = "심사자 홈 최근 심사 활동",
        description = "현재 로그인한 심사자가 남긴 기여 점수/학점 공개 전환·심사 코멘트 저장·평가 확정/취소 "
            + "활동을 최신순 최대 10건 반환한다. 심사 활동이 없으면 빈 배열을 반환한다."
    )
    @GetMapping("/reviewer-activities")
    public ApiResponse<List<ReviewerActivityDto>> myRecentActivities() {
        return ApiResponse.ok(reviewerService.getMyRecentActivities(CurrentUser.id()));
    }
}
```

이 변경으로 기존 `GET /api/v1/me/reviewer-projects` 경로는 그대로 유지된다(클래스 레벨
`/api/v1/me` + 메서드 레벨 `/reviewer-projects` = 동일 경로).

- [ ] **Step 9: 테스트 실행 — 통과 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.reviewer.ReviewerControllerTest" 2>&1 | tail -80
```
Expected: 모든 테스트(기존 2개 + 신규 2개) PASS.

- [ ] **Step 10: 전체 백엔드 테스트 실행 (회귀 확인)**

Run:
```
cd App/backend_spring && ./gradlew.bat test 2>&1 | tail -100
```
Expected: BUILD SUCCESSFUL.

- [ ] **Step 11: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/backend_spring/src/main/java/com/workflowai/reviewer/ App/backend_spring/src/test/java/com/workflowai/reviewer/
git commit -m "feat: 심사자 홈 최근 심사 활동 조회 API 추가"
```

---

## Task 5: 프론트엔드 — 심사자 홈 위젯을 실제 API로 교체

**Files:**
- Create: `App/frontend/src/global/api/reviewerActivityApi.ts`
- Modify: `App/frontend/src/auth/screen/ProjectEntryScreen.tsx`
- Modify: `App/frontend/src/global/lib/mock/reviewer.ts`

**Interfaces:**
- Consumes: 백엔드 `GET /api/v1/me/reviewer-activities` (Task 4) — 응답 필드 `id: string`, `projectTitle: string`, `message: string`, `createdAt: string`(ISO-8601 UTC).
- Produces: 없음(리프 화면 변경, 다른 파일이 이 변경에 의존하지 않는다 — `mypage/screen/MyPage.tsx`가 `reviewer.ts`의 `CONTRIB_REPORTS`를 계속 쓰므로 그 export는 건드리지 않는다).

이 화면(`ProjectEntryScreen.tsx`)은 기존에도 테스트 파일이 없으므로(레포 전수 조사 결과 없음
확인됨), 이번 작업도 기존 관례를 따라 테스트 파일을 신설하지 않는다. 대신 각 단계 후 타입
체크와 빌드로 회귀를 확인한다.

- [ ] **Step 1: `reviewerActivityApi.ts` 작성**

```typescript
import { apiFetch } from "./apiClient";

export interface ReviewerActivityDto {
  id: string;
  projectTitle: string;
  message: string;
  createdAt: string;
}

/** 심사자 홈 "최근 심사 활동" 위젯 — 로그인한 심사자 본인이 남긴 활동 최신순 최대 10건. */
export function fetchReviewerActivities(): Promise<ReviewerActivityDto[]> {
  return apiFetch<ReviewerActivityDto[]>("/me/reviewer-activities");
}
```

Write: `App/frontend/src/global/api/reviewerActivityApi.ts`

- [ ] **Step 2: 타입 체크 확인**

Run:
```
cd App/frontend && npx tsc --noEmit
```
Expected: 에러 없음(이 파일은 아직 아무도 참조하지 않으므로 기존 빌드에 영향 없음).

- [ ] **Step 3: `ProjectEntryScreen.tsx` 수정 — import 및 상태 교체**

`App/frontend/src/auth/screen/ProjectEntryScreen.tsx:19`의 다음 줄:

```typescript
import { REVIEWER_ACTIVITIES } from "../../global/lib/mock/reviewer";
```

을 다음으로 교체:

```typescript
import { fetchReviewerActivities, type ReviewerActivityDto } from "../../global/api/reviewerActivityApi";
```

`ProjectEntryScreen.tsx:56-66`의 다음 블록(`assignedProjects` state/useEffect) 바로 다음에
활동 조회 상태를 추가한다:

```typescript
  // 심사자 홈 "최근 심사 활동" — 실패해도 조용히 빈 배열로 폴백한다(부가 정보성 위젯).
  const [reviewerActivities, setReviewerActivities] = useState<ReviewerActivityDto[]>([]);
  useEffect(() => {
    if (!isJudgeHome) return;
    fetchReviewerActivities()
      .then(setReviewerActivities)
      .catch(() => setReviewerActivities([]));
  }, [isJudgeHome]);
```

- [ ] **Step 4: 날짜 포맷 헬퍼 추가**

`ProjectEntryScreen.tsx`의 `PROJECT_META` 상수 선언(파일 22번째 줄) 바로 다음에 헬퍼 함수를 추가:

```typescript
/** ISO-8601 문자열을 "MM.DD" 형식으로 변환한다. 파싱 실패 시 원본 문자열을 그대로 반환. */
function formatActivityDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}.${day}`;
}
```

- [ ] **Step 5: "최근 심사 활동" 섹션 렌더링 교체**

`ProjectEntryScreen.tsx:279-292`의 다음 블록:

```tsx
                <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardCheck className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-bold text-foreground">최근 심사 활동</h2>
                  </div>
                  <div className="space-y-3">
                    {REVIEWER_ACTIVITIES.map((activity, index) => (
                      <div key={`${activity.team}-${index}`} className="border-b border-border last:border-0 pb-3 last:pb-0">
                        <div className="text-xs font-semibold text-foreground">{activity.action}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{activity.team} · {activity.date}</div>
                      </div>
                    ))}
                  </div>
                </section>
```

을 다음으로 교체:

```tsx
                <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardCheck className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-bold text-foreground">최근 심사 활동</h2>
                  </div>
                  <div className="space-y-3">
                    {reviewerActivities.length === 0 && (
                      <div className="text-xs text-muted-foreground">아직 심사 활동이 없습니다.</div>
                    )}
                    {reviewerActivities.map((activity) => (
                      <div key={activity.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
                        <div className="text-xs font-semibold text-foreground">{activity.message}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {activity.projectTitle} · {formatActivityDate(activity.createdAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
```

- [ ] **Step 6: `reviewer.ts`에서 `REVIEWER_ACTIVITIES` 제거**

`App/frontend/src/global/lib/mock/reviewer.ts`를 읽고, 상단 주석과 `REVIEWER_ACTIVITIES` 상수
(파일 1-2번째 줄 주석 중 `REVIEWER_ACTIVITIES` 언급 부분, 29-34번째 줄 상수 전체)를 제거한다.
`REVIEWER_TEAMS`(3-8번째 줄)와 `CONTRIB_REPORTS`(10-27번째 줄)는 `mypage/screen/MyPage.tsx`가
여전히 `CONTRIB_REPORTS`를 참조하므로 그대로 둔다. 파일 상단 주석을 다음으로 교체:

```typescript
// REVIEWER_TEAMS는 ReviewerMyPage(Task 5)에서는 더 이상 쓰지 않지만
// ContributorsView.tsx가 여전히 참조하므로 유지한다(범위 밖 화면).
export const REVIEWER_TEAMS = [
```

- [ ] **Step 7: 타입 체크 및 빌드 확인**

Run:
```
cd App/frontend && npx tsc --noEmit
```
Expected: 에러 없음. `REVIEWER_ACTIVITIES`를 참조하는 다른 파일이 없는지 확인(이번 스펙 조사에서 `ProjectEntryScreen.tsx`가 유일한 사용처였음을 확인함).

Run:
```
cd App/frontend && npm run build 2>&1 | tail -40
```
Expected: 빌드 성공.

- [ ] **Step 8: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/frontend/src/global/api/reviewerActivityApi.ts App/frontend/src/auth/screen/ProjectEntryScreen.tsx App/frontend/src/global/lib/mock/reviewer.ts
git commit -m "feat: 심사자 홈 최근 심사 활동 위젯을 실제 API로 연동"
```

---

## Task 6: 프론트엔드 — 대시보드 활동 타임라인에 신규 타입 라벨/아이콘 추가

**Files:**
- Modify: `App/frontend/src/dashboard/libs/utils/activityDisplay.ts`
- Modify: `App/frontend/src/dashboard/screen/detail/ActivityPage.tsx`

**Interfaces:**
- Consumes: 없음(순수 함수/상수 파일 수정).
- Produces: `DashboardActivityType`에 7개 값 추가 — `ActivityPage.tsx`가 이미 이 타입의 상위집합인 문자열을 그대로 다루므로 별도 시그니처 변경 없음.

`activityDisplay.ts`는 순수 함수라 원칙적으로 단위 테스트 대상이지만, 레포 조사 결과 이 파일은
지금까지 테스트 파일이 없었다(기존 관례). 이번에도 신설하지 않고, Task 5와 동일하게 타입
체크/빌드로 회귀를 확인한다.

- [ ] **Step 1: `activityDisplay.ts` 수정**

`App/frontend/src/dashboard/libs/utils/activityDisplay.ts` 상단 import를 다음으로 교체:

```typescript
import {
  CheckCircle2,
  Eye,
  EyeOff,
  ListPlus,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Undo2,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { ActivityItemDto } from "../types/dashboard";
```

`DashboardActivityType` 타입 정의(11-25번째 줄)를 다음으로 교체:

```typescript
export type DashboardActivityType =
  | "TASK_CREATED"
  | "STATUS_CHANGED"
  | "ASSIGNEE_CHANGED"
  | "TASK_UPDATED"
  | "TASK_DELETED"
  | "CHECKLIST_CREATED"
  | "CHECKLIST_COMPLETED"
  | "CONTRIBUTION_SCORE_PUBLISHED"
  | "CONTRIBUTION_SCORE_UNPUBLISHED"
  | "GRADE_PUBLISHED"
  | "GRADE_UNPUBLISHED"
  | "REVIEW_COMMENT_SAVED"
  | "EVALUATION_FINALIZED"
  | "EVALUATION_UNFINALIZED";
```

`KNOWN_ACTIVITY_TYPES`(27-35번째 줄)를 다음으로 교체:

```typescript
const KNOWN_ACTIVITY_TYPES = new Set<DashboardActivityType>([
  "TASK_CREATED",
  "STATUS_CHANGED",
  "ASSIGNEE_CHANGED",
  "TASK_UPDATED",
  "TASK_DELETED",
  "CHECKLIST_CREATED",
  "CHECKLIST_COMPLETED",
  "CONTRIBUTION_SCORE_PUBLISHED",
  "CONTRIBUTION_SCORE_UNPUBLISHED",
  "GRADE_PUBLISHED",
  "GRADE_UNPUBLISHED",
  "REVIEW_COMMENT_SAVED",
  "EVALUATION_FINALIZED",
  "EVALUATION_UNFINALIZED",
]);
```

`activityTypeLabel` 함수 안의 `labels` 객체(42-54번째 줄)를 다음으로 교체:

```typescript
export function activityTypeLabel(type: string): string {
  const normalized = normalizeActivityType(type);
  const labels: Record<DashboardActivityType, string> = {
    TASK_CREATED: "업무 생성",
    STATUS_CHANGED: "업무 상태 변경",
    ASSIGNEE_CHANGED: "담당자 변경",
    TASK_UPDATED: "업무 수정",
    TASK_DELETED: "업무 삭제",
    CHECKLIST_CREATED: "체크리스트 생성",
    CHECKLIST_COMPLETED: "체크리스트 완료",
    CONTRIBUTION_SCORE_PUBLISHED: "기여 점수 공개",
    CONTRIBUTION_SCORE_UNPUBLISHED: "기여 점수 비공개 전환",
    GRADE_PUBLISHED: "학점 공개",
    GRADE_UNPUBLISHED: "학점 비공개 전환",
    REVIEW_COMMENT_SAVED: "심사 코멘트 작성",
    EVALUATION_FINALIZED: "평가 확정",
    EVALUATION_UNFINALIZED: "평가 확정 취소",
  };
  return labels[normalized];
}
```

`ACTIVITY_ICONS`(57-65번째 줄)를 다음으로 교체:

```typescript
/** activities.type 분류별 아이콘/색상 — ActivityPage(타임라인)와 DashboardView(요약 위젯)가 함께 쓴다. */
export const ACTIVITY_ICONS: Record<DashboardActivityType, { icon: LucideIcon; color: string; bg: string }> = {
  TASK_CREATED: { icon: Plus, color: "#7048E8", bg: "rgba(112,72,232,0.1)" },
  STATUS_CHANGED: { icon: RefreshCw, color: "#3B5BDB", bg: "#EEF1FB" },
  ASSIGNEE_CHANGED: { icon: UserCog, color: "#0EA5E9", bg: "#ECFEFF" },
  TASK_UPDATED: { icon: Pencil, color: "#F59E0B", bg: "#FFFBEB" },
  TASK_DELETED: { icon: Trash2, color: "#EF4444", bg: "#FEF2F2" },
  CHECKLIST_CREATED: { icon: ListPlus, color: "#10B981", bg: "#ECFDF5" },
  CHECKLIST_COMPLETED: { icon: CheckCircle2, color: "#059669", bg: "#ECFDF5" },
  CONTRIBUTION_SCORE_PUBLISHED: { icon: Eye, color: "#7048E8", bg: "rgba(112,72,232,0.1)" },
  CONTRIBUTION_SCORE_UNPUBLISHED: { icon: EyeOff, color: "#64748B", bg: "#F1F5F9" },
  GRADE_PUBLISHED: { icon: Eye, color: "#7048E8", bg: "rgba(112,72,232,0.1)" },
  GRADE_UNPUBLISHED: { icon: EyeOff, color: "#64748B", bg: "#F1F5F9" },
  REVIEW_COMMENT_SAVED: { icon: MessageSquare, color: "#0EA5E9", bg: "#ECFEFF" },
  EVALUATION_FINALIZED: { icon: CheckCircle2, color: "#059669", bg: "#ECFDF5" },
  EVALUATION_UNFINALIZED: { icon: Undo2, color: "#F59E0B", bg: "#FFFBEB" },
};
```

- [ ] **Step 2: `ActivityPage.tsx`에 필터 칩 추가**

`App/frontend/src/dashboard/screen/detail/ActivityPage.tsx:17`의 다음 줄:

```typescript
const TYPE_FILTERS = ["전체", "업무 생성", "상태 변경", "담당자 변경", "업무 수정", "업무 삭제", "체크리스트"] as const;
```

을 다음으로 교체:

```typescript
const TYPE_FILTERS = ["전체", "업무 생성", "상태 변경", "담당자 변경", "업무 수정", "업무 삭제", "체크리스트", "심사 활동"] as const;
```

`matchesTypeFilter` 함수(19-29번째 줄)의 마지막 `return true;` 이전에 분기를 추가:

```typescript
function matchesTypeFilter(type: string, filter: string) {
  if (filter === "전체") return true;
  const normalized = normalizeActivityType(type);
  if (filter === "업무 생성") return normalized === "TASK_CREATED";
  if (filter === "상태 변경") return normalized === "STATUS_CHANGED";
  if (filter === "담당자 변경") return normalized === "ASSIGNEE_CHANGED";
  if (filter === "업무 수정") return normalized === "TASK_UPDATED";
  if (filter === "업무 삭제") return normalized === "TASK_DELETED";
  if (filter === "체크리스트") return normalized === "CHECKLIST_CREATED" || normalized === "CHECKLIST_COMPLETED";
  if (filter === "심사 활동") {
    return (
      normalized === "CONTRIBUTION_SCORE_PUBLISHED" ||
      normalized === "CONTRIBUTION_SCORE_UNPUBLISHED" ||
      normalized === "GRADE_PUBLISHED" ||
      normalized === "GRADE_UNPUBLISHED" ||
      normalized === "REVIEW_COMMENT_SAVED" ||
      normalized === "EVALUATION_FINALIZED" ||
      normalized === "EVALUATION_UNFINALIZED"
    );
  }
  return true;
}
```

- [ ] **Step 3: 타입 체크 및 빌드 확인**

Run:
```
cd App/frontend && npx tsc --noEmit
```
Expected: 에러 없음.

Run:
```
cd App/frontend && npm run build 2>&1 | tail -40
```
Expected: 빌드 성공.

- [ ] **Step 4: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/frontend/src/dashboard/libs/utils/activityDisplay.ts App/frontend/src/dashboard/screen/detail/ActivityPage.tsx
git commit -m "feat: 대시보드 활동 타임라인에 심사 활동 타입 라벨/아이콘/필터 추가"
```

---

## 최종 검증

- [ ] **Step 1: 백엔드 전체 테스트**

Run:
```
cd App/backend_spring && ./gradlew.bat test 2>&1 | tail -60
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: 프론트엔드 전체 테스트**

Run:
```
cd App/frontend && npx vitest run 2>&1 | tail -60
```
Expected: 모든 테스트 PASS(신규 화면 테스트는 없지만 기존 스위트가 전부 통과해야 함 — 특히 `Header.test.tsx`, `MyPage.test.tsx`처럼 `reviewer.ts`/`evaluationApi.ts`를 참조하는 테스트).

- [ ] **Step 3: 프론트엔드 빌드**

Run:
```
cd App/frontend && npm run build 2>&1 | tail -40
```
Expected: 빌드 성공, 타입 에러 0.

- [ ] **Step 4: 수동 확인 (선택)**

로컬 실행 후 심사자 계정으로 로그인 → 기여도 분석 화면에서 공개 토글/코멘트 저장/평가 확정을
수행 → 심사자 홈으로 돌아가 "최근 심사 활동"에 방금 한 액션이 나타나는지 확인. 같은 프로젝트를
팀원 계정으로 열어 대시보드 "최근 활동"에도 같은 항목이 보이는지 확인.
