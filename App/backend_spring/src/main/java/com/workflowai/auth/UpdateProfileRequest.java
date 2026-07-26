package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "내 프로필 수정 요청")
public record UpdateProfileRequest(
    @Schema(example = "이서연") String name,
    @Schema(description = "소속", example = "컴퓨터공학과 3학년") String affiliation,
    @Schema(description = "분야 태그", example = "[\"프론트엔드\", \"UX\"]") List<String> field,
    @Schema(description = "GitHub 아이디 (URL 아님)", example = "octocat") String githubUsername
) {
}
