package com.workflowai.comment;

import com.workflowai.common.UtcTimeFormat;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "개인 코멘트/답글")
public record PersonalCommentDto(
    @Schema(description = "코멘트 ID", example = "12") Long id,
    @Schema(description = "작성자 사용자 ID") Long authorId,
    @Schema(description = "작성자 이름") String authorName,
    @Schema(description = "부모 코멘트 ID. null이면 원 코멘트") Long parentId,
    @Schema(description = "내용") String content,
    @Schema(description = "작성 시각 (ISO-8601)") String createdAt
) {
    public static PersonalCommentDto from(PersonalComment comment, String authorName) {
        return new PersonalCommentDto(
            comment.getId(), comment.getAuthorId(), authorName,
            comment.getParentId(), comment.getContent(), UtcTimeFormat.toIsoUtc(comment.getCreatedAt())
        );
    }
}
