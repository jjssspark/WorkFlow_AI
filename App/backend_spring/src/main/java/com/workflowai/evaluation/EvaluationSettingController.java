package com.workflowai.evaluation;

import com.workflowai.common.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "평가 설정", description = "학점 계산기 점수 비율(기여 점수 %) 조회/저장")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/evaluation-settings")
public class EvaluationSettingController {
    private final EvaluationSettingRepository evaluationSettingRepository;

    public EvaluationSettingController(EvaluationSettingRepository evaluationSettingRepository) {
        this.evaluationSettingRepository = evaluationSettingRepository;
    }

    @Operation(
        summary = "학점 계산기 점수 비율 조회",
        description = "프로젝트에 저장된 기여 점수 반영 비율(%)을 조회한다. 저장한 적 없으면 기본값(40%)을 반환한다. 심사자만 호출 가능하다."
    )
    @GetMapping
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    public ApiResponse<EvaluationSettingResponse> get(@PathVariable Long projectId) {
        EvaluationSettingResponse response = evaluationSettingRepository.findById(projectId)
            .map(EvaluationSettingResponse::from)
            .orElseGet(() -> EvaluationSettingResponse.defaultFor(projectId));
        return ApiResponse.ok(response);
    }

    @Operation(
        summary = "학점 계산기 점수 비율 저장",
        description = "심사자가 기여 점수 반영 비율(%)을 변경할 때 호출한다. 프로젝트당 설정 1건을 upsert한다. 심사자만 호출 가능하다."
    )
    @PutMapping
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'REVIEWER')")
    @Transactional
    public ApiResponse<EvaluationSettingResponse> upsert(
        @PathVariable Long projectId,
        @Valid @RequestBody EvaluationSettingRequest request
    ) {
        EvaluationSetting entity = evaluationSettingRepository.findById(projectId)
            .orElseGet(() -> new EvaluationSetting(projectId, request.contributionRatio()));
        entity.setContributionRatio(request.contributionRatio());
        EvaluationSetting saved = evaluationSettingRepository.save(entity);
        return ApiResponse.ok(EvaluationSettingResponse.from(saved));
    }
}
