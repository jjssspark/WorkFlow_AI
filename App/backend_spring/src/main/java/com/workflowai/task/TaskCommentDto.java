package com.workflowai.task;

import com.workflowai.common.UtcTimeFormat;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "업무 코멘트")
public record TaskCommentDto(
    @Schema(description = "코멘트 ID", example = "12") String id,
    @Schema(description = "작성자 mock id (\"1\"~\"4\")", example = "1") String authorId,
    @Schema(description = "작성자 이름", example = "김민준") String authorName,
    @Schema(description = "내용") String content,
    @Schema(description = "구분 (\"COMMENT\" | \"FEEDBACK\")", example = "COMMENT") String type,
    @Schema(description = "작성 시각 (ISO-8601)") String createdAt
) {
    public static TaskCommentDto from(TaskComment comment, String authorName, String authorMockId) {
        return new TaskCommentDto(
            String.valueOf(comment.getId()),
            authorMockId,
            authorName,
            comment.getContent(),
            comment.getType(),
            UtcTimeFormat.toIsoUtc(comment.getCreatedAt())
        );
    }
}
