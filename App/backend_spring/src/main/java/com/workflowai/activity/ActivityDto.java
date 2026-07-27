package com.workflowai.activity;

import com.workflowai.common.UtcTimeFormat;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "활동 로그 항목")
public record ActivityDto(
    @Schema(description = "활동 ID", example = "9") String id,
    @Schema(description = "행위자 이름", example = "김민준") String actorName,
    @Schema(description = "종류", example = "STATUS_CHANGED") String type,
    @Schema(description = "화면에 보여줄 메시지") String message,
    @Schema(description = "발생 시각 (ISO-8601)") String createdAt
) {
    public static ActivityDto from(Activity activity, String actorName) {
        return new ActivityDto(
            String.valueOf(activity.getId()),
            actorName,
            activity.getType(),
            activity.getMessage(),
            UtcTimeFormat.toIsoUtc(activity.getCreatedAt())
        );
    }
}
