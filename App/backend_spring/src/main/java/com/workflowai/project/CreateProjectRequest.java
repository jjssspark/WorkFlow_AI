package com.workflowai.project;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;
import java.util.List;

@Schema(description = "프로젝트 생성(온보딩) 요청")
public record CreateProjectRequest(
    @Schema(example = "스마트 주차 관리 시스템") @NotBlank String title,
    @Schema(example = "캡스톤디자인", description = "캡스톤디자인/팀프로젝트/공모전/해커톤/기타") String type,
    @Schema(example = "2026", description = "프로젝트 진행 연도") Integer year,
    @Schema(example = "주차 공간 실시간 탐지 및 예약 서비스") String description,
    @Schema(example = "2026-03-01") LocalDate startDate,
    @Schema(description = "최종 마감일", example = "2026-07-18") LocalDate deadline,
    @Schema(description = "중간 점검/중간보고일 (선택)", example = "2026-05-15") LocalDate midCheckDate,
    @Schema(description = "예상 참여 인원 수", example = "6") Integer memberLimit,
    @Schema(example = "[\"발표자료\", \"보고서\", \"서비스 배포\"]") List<String> deliverables,
    @Schema(example = "[\"Spring Boot\", \"React\", \"YOLO\"]") List<String> techStack,
    @Schema(example = "MVP까지 목표, 매주 수요일 정기회의") String goals
) {
}
