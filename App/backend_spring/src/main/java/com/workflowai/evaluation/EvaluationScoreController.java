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
            saved.getUserId(), saved.getProjectId(), type, title, content, "evaluation", saved.getProjectId()
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
