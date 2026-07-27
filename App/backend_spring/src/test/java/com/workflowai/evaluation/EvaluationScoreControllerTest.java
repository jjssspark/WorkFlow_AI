package com.workflowai.evaluation;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.common.GlobalExceptionHandler;
import com.workflowai.project.ProjectMemberRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EvaluationScoreControllerTest {

    @Mock
    private EvaluationScoreRepository evaluationScoreRepository;

    @Mock
    private ProjectMemberRepository projectMemberRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private MockMvc mockMvc() {
        return MockMvcBuilders
            .standaloneSetup(new EvaluationScoreController(evaluationScoreRepository, projectMemberRepository))
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
