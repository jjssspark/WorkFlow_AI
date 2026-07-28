# 기여도 점수/학점 공개 시 학생 알림 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 심사자가 학생별 기여도 점수/학점 공개 토글을 비공개→공개로 전환하는 순간, 해당 학생에게 알림이 발송되고, 알림 클릭 시 마이페이지로 이동하게 한다.

**Architecture:** `EvaluationScoreController.upsert`에서 플래그 갱신 전/후 값을 비교해 off→on 전이를 감지하고, 기존 `NotificationService.notifyAfterCommit`을 호출해 알림을 저장·비동기 발송한다(트랜잭션 커밋 후, 실패해도 본 API에 영향 없음). 프론트는 기존 알림 드롭다운(`Header.tsx`)에 `targetType === "evaluation"` 케이스의 바로가기 버튼만 추가한다. 새 테이블/인프라 없음 — 모두 기존 알림 시스템 재사용.

**Tech Stack:** Spring Boot(Java 21), JPA, Mockito/MockMvc(백엔드 테스트), React + TypeScript, Vitest + Testing Library(프론트 테스트)

## Global Constraints

- 알림은 **off→on 전이일 때만** 발송한다. on→off, on 상태를 다시 true로 저장, 이미 off인 걸 유지하는 호출은 알림을 보내지 않는다.
- 알림 대상은 **`EvaluationScore.userId` 한 명뿐**이다 (팀 브로드캐스트 아님).
- 기여도 점수 공개(`contributionPublic`)와 학점 공개(`finalPublic`)는 **서로 다른 알림 타입**으로 독립 발송한다. 한 호출에서 둘 다 off→on이면 두 알림 모두 발송.
- 알림 타입/문구:
  - `CONTRIBUTION_SCORE_PUBLISHED` / 제목 `"기여도 점수가 공개되었습니다."` / 내용 `"심사자가 '{프로젝트명}' 프로젝트의 기여도 점수를 공개했습니다."`
  - `GRADE_PUBLISHED` / 제목 `"학점이 공개되었습니다."` / 내용 `"심사자가 '{프로젝트명}' 프로젝트의 학점을 공개했습니다."`
- `targetType="evaluation"`, `targetId=projectId`로 저장한다.
- 알림 발송은 `notificationService.notifyAfterCommit(...)`을 사용한다(부가 기능이라 실패해도 본 트랜잭션에 영향 없어야 함 — 기존 관례).
- 두 알림 타입은 `ACTION_REQUIRED_NOTIFICATION_TYPES`에 포함하지 않는다(정보 전달성 알림이지 미처리 작업 배지가 아님).
- 알림 클릭 시 이동 대상은 항상 `/mypage`로 고정한다(프로젝트 자동 전환 없음).

---

## Task 1: 백엔드 — off→on 전이 감지 및 알림 발송

**Files:**
- Modify: `App/backend_spring/src/main/java/com/workflowai/evaluation/EvaluationScoreController.java`
- Test: `App/backend_spring/src/test/java/com/workflowai/evaluation/EvaluationScoreControllerTest.java`

**Interfaces:**
- Consumes: `NotificationService.notifyAfterCommit(Long userId, String type, String title, String content, String targetType, Long targetId)` (기존 `App/backend_spring/src/main/java/com/workflowai/notification/NotificationService.java:34`에 이미 존재, 시그니처 변경 없음), `ProjectRepository.findById(Long)` → `Optional<Project>` (기존 `App/backend_spring/src/main/java/com/workflowai/project/ProjectRepository.java`에 JpaRepository 상속으로 이미 존재), `Project.getTitle()` (기존 `App/backend_spring/src/main/java/com/workflowai/project/Project.java`).
- Produces: `EvaluationScoreController`가 생성자에 `ProjectRepository`, `NotificationService`를 새로 받는다 — 이 컨트롤러를 인스턴스화하는 다른 코드(테스트 등)는 생성자 인자를 4개로 맞춰야 한다.

### Step 1: 실패하는 테스트부터 작성 — off→on 전이 시 기여도 점수 알림 발송

`EvaluationScoreControllerTest.java` 상단 import와 필드에 `NotificationService` mock, `ProjectRepository` mock을 추가하고, `mockMvc()` 헬퍼가 새 생성자 인자를 넘기도록 수정한다.

- [ ] **Step 1a: import 및 mock 필드 추가**

`EvaluationScoreControllerTest.java` 파일 상단을 다음과 같이 수정한다(기존 import에 추가):

```java
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectRepository;
import java.util.Optional;
```

(`Optional`은 이미 import되어 있으므로 중복 추가하지 않는다 — 기존 파일의 `import java.util.Optional;`을 그대로 사용.)

클래스 필드에 추가:

```java
@Mock
private ProjectRepository projectRepository;

@Mock
private NotificationService notificationService;
```

`mockMvc()` 헬퍼를 다음과 같이 수정한다:

```java
private MockMvc mockMvc() {
    return MockMvcBuilders
        .standaloneSetup(new EvaluationScoreController(
            evaluationScoreRepository, projectMemberRepository, projectRepository, notificationService
        ))
        .setControllerAdvice(new GlobalExceptionHandler())
        .build();
}
```

이 시점에서는 `EvaluationScoreController` 생성자가 아직 2개 인자만 받으므로 컴파일 에러가 난다 — 정상이다(다음 스텝에서 프로덕션 코드를 고친다).

- [ ] **Step 1b: 새 테스트 케이스 추가**

파일 마지막 테스트(`upsertAcceptsAGradeVariantWithoutTrailingZero`) 다음, `listReturnsScoreTotalScoreReviewerScoreAndGradeFields` 앞에 추가:

```java
@Test
void upsertSendsContributionScorePublishedNotificationWhenTogglingOffToOn() throws Exception {
    // 기여도 점수 공개 토글이 false→true로 바뀌는 순간에만 학생 본인에게 알림을 보낸다.
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    Project project = new Project("캡스톤디자인 2024", "capstone", "설명");
    when(projectRepository.findById(1L)).thenReturn(Optional.of(project));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, true, null, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(notificationService).notifyAfterCommit(
        3L, "CONTRIBUTION_SCORE_PUBLISHED", "기여도 점수가 공개되었습니다.",
        "심사자가 '캡스톤디자인 2024' 프로젝트의 기여도 점수를 공개했습니다.", "evaluation", 1L
    );
}

@Test
void upsertSendsGradePublishedNotificationWhenTogglingFinalPublicOffToOn() throws Exception {
    // 학점(총합) 공개 토글이 false→true로 바뀌는 순간에만 학생 본인에게 알림을 보낸다.
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    Project project = new Project("캡스톤디자인 2024", "capstone", "설명");
    when(projectRepository.findById(1L)).thenReturn(Optional.of(project));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, null, true, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(notificationService).notifyAfterCommit(
        3L, "GRADE_PUBLISHED", "학점이 공개되었습니다.",
        "심사자가 '캡스톤디자인 2024' 프로젝트의 학점을 공개했습니다.", "evaluation", 1L
    );
}

@Test
void upsertDoesNotSendNotificationWhenAlreadyPublicAndSavedAgain() throws Exception {
    // 이미 공개된 상태에서 다시 true로 저장해도(예: 다른 필드만 갱신하는 호출) 중복 알림이 가면 안 된다.
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), true);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, true, null, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
}

@Test
void upsertDoesNotSendNotificationWhenTogglingOnToOff() throws Exception {
    // 공개→비공개 전환 시에는 알림을 보내지 않는다.
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), true);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, false, null, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any());
}

@Test
void upsertSendsBothNotificationsWhenContributionAndFinalBothToggleOnInOneCall() throws Exception {
    // 한 호출에서 기여도 점수와 학점 공개가 동시에 false→true로 바뀌면 두 알림이 모두 발송된다.
    EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
    when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
    when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
    when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
    Project project = new Project("캡스톤디자인 2024", "capstone", "설명");
    when(projectRepository.findById(1L)).thenReturn(Optional.of(project));

    EvaluationScoreRequest request = new EvaluationScoreRequest(
        1L, 3L, null, null, true, true, null, null, null, null
    );

    mockMvc().perform(post("/api/v1/projects/1/evaluations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk());

    verify(notificationService).notifyAfterCommit(
        eq(3L), eq("CONTRIBUTION_SCORE_PUBLISHED"), any(), any(), eq("evaluation"), eq(1L)
    );
    verify(notificationService).notifyAfterCommit(
        eq(3L), eq("GRADE_PUBLISHED"), any(), any(), eq("evaluation"), eq(1L)
    );
}
```

이 테스트들이 참조하는 `verify`, `never`, `eq`는 정적 import가 필요하다. 파일 상단 static import 블록에 다음을 추가한다:

```java
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
```

(`any`는 이미 `import static org.mockito.ArgumentMatchers.any;`로 존재하므로 재사용.)

- [ ] **Step 2: 테스트 실행 — 컴파일 실패 확인**

Run (Windows, 프로젝트 루트에서):
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.evaluation.EvaluationScoreControllerTest" 2>&1 | tail -60
```
Expected: 컴파일 에러 — `EvaluationScoreController(EvaluationScoreRepository, ProjectMemberRepository)` 생성자가 4개 인자를 받는 호출과 맞지 않음, 또는 `Project`/`ProjectRepository`/`NotificationService` 관련 미해결 참조.

- [ ] **Step 3: 프로덕션 코드 수정 — 생성자에 의존성 추가 및 전이 감지 로직 구현**

`EvaluationScoreController.java` 전체를 다음으로 교체한다:

```java
package com.workflowai.evaluation;

import com.workflowai.common.ApiResponse;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.security.CurrentUser;
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

    public EvaluationScoreController(
        EvaluationScoreRepository evaluationScoreRepository,
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        NotificationService notificationService
    ) {
        this.evaluationScoreRepository = evaluationScoreRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.notificationService = notificationService;
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

        // 공개 플래그를 덮어쓰기 전 값을 기억해뒀다가, 저장 후 값과 비교해 off→on 전이만 학생에게
        // 알린다. on→off 전환이나, 이미 공개된 상태에서 다시 true로 저장하는 호출(다른 필드만
        // 갱신하는 호출 포함)은 알림을 보내지 않는다.
        boolean wasContributionPublic = entity.isContributionPublic();
        boolean wasFinalPublic = entity.isFinalPublic();

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

`Project`의 no-arg 생성자(`Project.java:72`)는 `protected`라 `evaluation` 패키지의 테스트에서 접근할 수 없다 — 테스트 코드는 위처럼 public 생성자 `Project(String title, String type, String description)`(`Project.java:83`)을 사용한다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run:
```
cd App/backend_spring && ./gradlew.bat test --tests "com.workflowai.evaluation.EvaluationScoreControllerTest" 2>&1 | tail -60
```
Expected: 모든 테스트(기존 12개 + 신규 5개) PASS.

- [ ] **Step 5: 전체 백엔드 테스트 실행 (회귀 확인)**

Run:
```
cd App/backend_spring && ./gradlew.bat test 2>&1 | tail -80
```
Expected: BUILD SUCCESSFUL (다른 곳에서 `new EvaluationScoreController(...)`를 2-인자로 호출하는 코드가 없는지 확인 — 있다면 컴파일 에러가 뜨므로 그 호출부도 함께 고친다).

- [ ] **Step 6: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/backend_spring/src/main/java/com/workflowai/evaluation/EvaluationScoreController.java App/backend_spring/src/test/java/com/workflowai/evaluation/EvaluationScoreControllerTest.java
git commit -m "feat: 기여도 점수/학점 공개 전환 시 학생에게 알림 발송"
```

---

## Task 2: 프론트엔드 — 알림 드롭다운에 evaluation 바로가기 버튼 추가

**Files:**
- Modify: `App/frontend/src/global/component/layout/Header.tsx:184-194`
- Test: `App/frontend/src/global/component/layout/Header.test.tsx`

**Interfaces:**
- Consumes: `NotificationResponse` 타입(기존 `App/frontend/src/global/api/notificationApi.ts:4-13`, 필드 변경 없음 — `targetType: string | null`, `targetId: string | null`이 이미 임의의 문자열을 그대로 받음).
- Produces: 없음(리프 컴포넌트 변경, 다른 파일이 이 변경에 의존하지 않음).

### Step 1: 실패하는 테스트 작성

`Header.test.tsx`의 `describe("Header 알림", ...)` 블록 내, 마지막 테스트(`"액션불필요 알림에는 바로가기 버튼이 없다"`) 바로 다음에 추가:

```tsx
  it("평가 공개 알림(evaluation)에도 바로가기 버튼이 보이고 클릭 시 마이페이지로 이동한다", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue([
      { id: "1", type: "CONTRIBUTION_SCORE_PUBLISHED", title: "기여도 점수가 공개되었습니다.", content: "심사자가 '캡스톤디자인 2024' 프로젝트의 기여도 점수를 공개했습니다.", targetType: "evaluation", targetId: "5", read: false, createdAt: new Date().toISOString() },
    ]);
    vi.mocked(markNotificationsRead).mockResolvedValue(undefined);

    renderHeader();
    await openBell();

    const shortcutButton = await screen.findByRole("button", { name: "바로가기" });
    await userEvent.click(shortcutButton);

    expect(mockNavigate).toHaveBeenCalledWith("/mypage");
  });
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run:
```
cd App/frontend && npx vitest run src/global/component/layout/Header.test.tsx
```
Expected: FAIL — "바로가기" role을 가진 버튼을 찾지 못함(`targetType === "evaluation"` 분기가 아직 없으므로).

- [ ] **Step 3: `Header.tsx`에 바로가기 버튼 분기 추가**

`Header.tsx:184-194`(기존 `{isActionRequired && n.targetType === "meeting" && n.targetId && (...)}` 블록) 바로 다음에 추가:

```tsx
                        {n.targetType === "evaluation" && n.targetId && (
                          <button
                            onClick={() => {
                              setNotifOpen(false);
                              navigate("/mypage");
                            }}
                            className="mt-1.5 px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-semibold hover:bg-blue-700"
                          >
                            바로가기
                          </button>
                        )}
```

이 블록은 `isActionRequired` 조건과 무관하게(기여도/학점 공개 알림은 액션필요 배지 대상이 아니므로) 항상 `targetType === "evaluation"`일 때 렌더링된다.

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run:
```
cd App/frontend && npx vitest run src/global/component/layout/Header.test.tsx
```
Expected: 모든 테스트(기존 6개 + 신규 1개) PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/AI-projects/work-flow
git add App/frontend/src/global/component/layout/Header.tsx App/frontend/src/global/component/layout/Header.test.tsx
git commit -m "feat: 평가 공개 알림 클릭 시 마이페이지로 이동하는 바로가기 버튼 추가"
```

---

## 최종 검증

- [ ] **Step 1: 백엔드 전체 테스트**

Run:
```
cd App/backend_spring && ./gradlew.bat test 2>&1 | tail -40
```
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: 프론트엔드 전체 테스트**

Run:
```
cd App/frontend && npx vitest run 2>&1 | tail -40
```
Expected: 모든 테스트 PASS
