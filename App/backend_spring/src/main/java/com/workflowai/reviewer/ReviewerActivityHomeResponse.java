package com.workflowai.reviewer;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 심사자 홈에 필요한 활동 데이터. "최근 심사 활동" 카드와 배정 프로젝트 목록의 최근 접속순
 * 정렬을 한 번의 요청으로 채우려고 두 값을 함께 내려준다.
 *
 * <p>lastAccess를 activities에서 유도하지 않는 이유: activities는 카드에 보여줄 만큼만
 * 잘라서 내려주므로, 오래전에 접속하고 그 뒤로 활동이 많았던 프로젝트는 목록에서 밀려난다.
 * 그 상태로 정렬하면 접속한 적 있는 프로젝트가 "접속 기록 없음"으로 취급된다.
 */
public record ReviewerActivityHomeResponse(
    @Schema(description = "최근 심사 활동 (최신순)") List<Activity> activities,
    @Schema(description = "프로젝트별 마지막 접속 시각") List<LastAccess> lastAccess
) {
    public record Activity(
        @Schema(description = "프로젝트 ID", example = "1") Long projectId,
        @Schema(description = "프로젝트 제목", example = "스마트 주차 관리 시스템") String projectTitle,
        @Schema(description = "활동 종류", example = "PROJECT_ACCESS") String activityType,
        @Schema(description = "화면에 표시할 활동 문구", example = "프로젝트 접속") String activityLabel,
        @Schema(description = "활동 시각") LocalDateTime createdAt
    ) {
    }

    public record LastAccess(
        @Schema(description = "프로젝트 ID", example = "1") Long projectId,
        @Schema(description = "마지막 접속 시각") LocalDateTime lastAccessedAt
    ) {
    }
}
