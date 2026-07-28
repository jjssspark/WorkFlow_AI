package com.workflowai.evaluation;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.common.GlobalExceptionHandler;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.reviewer.ReviewerActivityService;
import com.workflowai.security.UserPrincipal;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EvaluationScoreControllerTest {

    @Mock
    private EvaluationScoreRepository evaluationScoreRepository;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private NotificationService notificationService;

    @Mock
    private ReviewerActivityService reviewerActivityService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // upsert는 심사자 활동을 기록하려고 CurrentUser.id()를 읽는다. 운영에서는 @PreAuthorize를
    // 통과한 심사자만 도달하므로 인증이 항상 존재하지만, standalone MockMvc에는 필터가 없어
    // SecurityContext를 여기서 직접 채워줘야 한다.
    @BeforeEach
    void authenticate() {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(9L, "reviewer@workflow.ai", "심사자"), null, List.of()
            )
        );
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private MockMvc mockMvc() {
        return MockMvcBuilders
            .standaloneSetup(new EvaluationScoreController(
                evaluationScoreRepository, projectMemberRepository, projectRepository, notificationService,
                reviewerActivityService
            ))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    void upsertSavesTotalScoreReviewerScoreAndGradeFromCalculatorWithoutTouchingScore() throws Exception {
        // 학점 계산기 저장은 totalScore/reviewerScore/grade만 채우고 score(AI 기여 점수)는
        // 건드리지 않는다 — 회귀 테스트(과거 버그: score 필드를 공유해 총합이 기여 점수를 덮어썼다).
        EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
        when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
        when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, new BigDecimal("77.20"), null, null, null, new BigDecimal("90.00"), "A+", null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.score").value(60.00))
            .andExpect(jsonPath("$.data.totalScore").value(77.20))
            .andExpect(jsonPath("$.data.reviewerScore").value(90.00))
            .andExpect(jsonPath("$.data.grade").value("A+"));
    }

    @Test
    void upsertKeepsExistingScoreReviewerScoreAndGradeWhenTogglingContributionPublicOnly() throws Exception {
        // 왼쪽 기여도 테이블의 공개/비공개 토글은 contributionPublic만 보내고 나머지는 전부
        // null이어야 한다 — 이미 학점 계산기에서 저장해 둔 총점(totalScore)/심사자점수/학점/
        // finalPublic/commentPublic을 덮어쓰면 안 된다.
        // (회귀 테스트: 과거 버그 — 공개 토글이 기여 점수를 score로 다시 보내 총점을 덮어썼다.
        //  세 공개 플래그 분리 이후에는 서로 다른 화면의 토글이 다른 플래그를 건드리면 안 된다.)
        EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), false);
        existing.setTotalScore(new BigDecimal("77.20"));
        existing.setReviewerScore(new BigDecimal("90.00"));
        existing.setGrade("A+");
        existing.setFinalPublic(true);
        existing.setCommentPublic(true);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
        when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
        when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, null, true, null, null, null, null, null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.contributionPublic").value(true))
            .andExpect(jsonPath("$.data.finalPublic").value(true))
            .andExpect(jsonPath("$.data.commentPublic").value(true))
            .andExpect(jsonPath("$.data.score").value(60.00))
            .andExpect(jsonPath("$.data.totalScore").value(77.20))
            .andExpect(jsonPath("$.data.reviewerScore").value(90.00))
            .andExpect(jsonPath("$.data.grade").value("A+"));
    }

    @Test
    void upsertTogglingFinalPublicDoesNotAffectContributionOrCommentPublic() throws Exception {
        // 학점 계산기의 공개/비공개 토글은 finalPublic만 보내야 하고, 기존 contributionPublic/
        // commentPublic 값은 그대로 유지되어야 한다 — 세 토글의 독립성 검증.
        EvaluationScore existing = new EvaluationScore(1L, 3L, new BigDecimal("77.20"), true);
        existing.setCommentPublic(true);
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
        when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.of(existing));
        when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, null, null, true, null, null, null, null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.contributionPublic").value(true))
            .andExpect(jsonPath("$.data.finalPublic").value(true))
            .andExpect(jsonPath("$.data.commentPublic").value(true));
    }

    @Test
    void upsertSavesCommentAndTogglesCommentPublicIndependently() throws Exception {
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
        when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.empty());
        when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, null, null, null, true, null, null, "팀장으로서 팀을 잘 이끌어주고 있습니다."
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.commentPublic").value(true))
            .andExpect(jsonPath("$.data.comment").value("팀장으로서 팀을 잘 이끌어주고 있습니다."))
            .andExpect(jsonPath("$.data.contributionPublic").value(false))
            .andExpect(jsonPath("$.data.finalPublic").value(false));
    }

    @Test
    void upsertReturns400WhenUserIsNotProjectMember() throws Exception {
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 999L)).thenReturn(false);

        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 999L, new BigDecimal("50.00"), null, false, null, null, null, null, null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("USER_NOT_PROJECT_MEMBER"));
    }

    @Test
    void upsertReturns400WhenScoreOutOfRange() throws Exception {
        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, new BigDecimal("150.00"), null, false, null, null, null, null, null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    @Test
    void upsertReturns400WhenTotalScoreOutOfRange() throws Exception {
        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, new BigDecimal("150.00"), false, null, null, null, null, null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    @Test
    void upsertReturns400WhenReviewerScoreOutOfRange() throws Exception {
        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, null, false, null, null, new BigDecimal("-1"), null, null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    @Test
    void upsertReturns400WhenGradeNotInAllowedList() throws Exception {
        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, null, null, false, null, null, null, "S+", null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    @Test
    void upsertAcceptsAGradeVariantWithoutTrailingZero() throws Exception {
        // A0 대신 A만 쓰는 학교 표기(A/B/C/D)도 허용해야 한다.
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 3L)).thenReturn(true);
        when(evaluationScoreRepository.findByProjectIdAndUserId(1L, 3L)).thenReturn(Optional.empty());
        when(evaluationScoreRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        EvaluationScoreRequest request = new EvaluationScoreRequest(
            1L, 3L, new BigDecimal("60.00"), null, false, null, null, null, "A", null
        );

        mockMvc().perform(post("/api/v1/projects/1/evaluations")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.grade").value("A"));
    }

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
            3L, 1L, "CONTRIBUTION_SCORE_PUBLISHED", "기여도 점수가 공개되었습니다.",
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
            3L, 1L, "GRADE_PUBLISHED", "학점이 공개되었습니다.",
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

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
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

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
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
            eq(3L), eq(1L), eq("CONTRIBUTION_SCORE_PUBLISHED"), any(), any(), eq("evaluation"), eq(1L)
        );
        verify(notificationService).notifyAfterCommit(
            eq(3L), eq(1L), eq("GRADE_PUBLISHED"), any(), any(), eq("evaluation"), eq(1L)
        );
    }

    @Test
    void listReturnsScoreTotalScoreReviewerScoreAndGradeFields() throws Exception {
        EvaluationScore saved = new EvaluationScore(1L, 3L, new BigDecimal("60.00"), true);
        saved.setTotalScore(new BigDecimal("77.20"));
        saved.setReviewerScore(new BigDecimal("90.00"));
        saved.setGrade("A+");
        when(evaluationScoreRepository.findAllByProjectId(1L)).thenReturn(List.of(saved));

        mockMvc().perform(get("/api/v1/projects/1/evaluations"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].score").value(60.00))
            .andExpect(jsonPath("$.data[0].totalScore").value(77.20))
            .andExpect(jsonPath("$.data[0].reviewerScore").value(90.00))
            .andExpect(jsonPath("$.data[0].grade").value("A+"));
    }
}
