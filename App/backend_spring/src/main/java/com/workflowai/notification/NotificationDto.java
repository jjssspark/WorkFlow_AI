package com.workflowai.notification;

import com.workflowai.common.UtcTimeFormat;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "알림 항목")
public record NotificationDto(
    @Schema(description = "알림 ID", example = "17") String id,
    @Schema(description = "종류", example = "TASK_ASSIGNED") String type,
    @Schema(description = "제목") String title,
    @Schema(description = "내용") String content,
    @Schema(description = "대상 종류", example = "task") String targetType,
    @Schema(description = "대상 id") String targetId,
    @Schema(
        description = "이 알림이 속한 프로젝트 id. 어느 프로젝트로도 환원되지 않으면 null이며, "
            + "그 경우 클라이언트는 프로젝트와 무관한 알림으로 다룬다.",
        example = "1", nullable = true
    ) String projectId,
    @Schema(description = "읽음 여부") boolean read,
    @Schema(description = "발생 시각 (ISO-8601)") String createdAt
) {
    public static NotificationDto from(Notification notification, Long projectId) {
        return new NotificationDto(
            String.valueOf(notification.getId()),
            notification.getType(),
            notification.getTitle(),
            notification.getContent(),
            notification.getTargetType(),
            notification.getTargetId() == null ? null : String.valueOf(notification.getTargetId()),
            projectId == null ? null : String.valueOf(projectId),
            notification.isRead(),
            UtcTimeFormat.toIsoUtc(notification.getCreatedAt())
        );
    }
}
