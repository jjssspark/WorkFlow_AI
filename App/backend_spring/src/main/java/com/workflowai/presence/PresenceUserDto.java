package com.workflowai.presence;

import io.swagger.v3.oas.annotations.media.Schema;

public record PresenceUserDto(
    @Schema(description = "사용자 ID", example = "1") Long userId,
    @Schema(description = "이름", example = "허영주") String name,
    @Schema(description = "역할", example = "팀장") String role,
    @Schema(description = "프로필 사진 서명 URL (만료시간 있음, null이면 미설정)") String avatarUrl
) {
}
