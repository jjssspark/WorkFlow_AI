package com.workflowai.comment;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "개인 코멘트/답글 작성 요청")
public record PersonalCommentCreateRequest(
    @Schema(description = "내용") String content
) {}
