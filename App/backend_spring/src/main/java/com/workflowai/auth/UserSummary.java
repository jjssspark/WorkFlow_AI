package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "사용자 기본 정보")
public record UserSummary(
    Long id,
    String email,
    String name,
    @Schema(description = "소속 (예: 컴퓨터공학과 3학년)") String affiliation,
    @Schema(description = "전공/관심 분야 태그") List<String> field,
    @Schema(description = "GitHub 아이디 (URL 아님)") String githubUsername,
    @Schema(description = "프로필 사진 서명 URL (만료시간 있음, null이면 미설정)") String avatarUrl,
    @Schema(description = "전역 관리자 여부") boolean isAdmin
) {
}
