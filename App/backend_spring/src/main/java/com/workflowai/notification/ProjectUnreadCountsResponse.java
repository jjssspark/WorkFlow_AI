package com.workflowai.notification;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

@Schema(description = "프로젝트별 안 읽은 알림 개수")
public record ProjectUnreadCountsResponse(
    @Schema(description = "projectId를 키로 하는 미읽음 개수 맵", example = "{\"12\": 3, \"15\": 1}")
    Map<String, Long> counts
) {
}
