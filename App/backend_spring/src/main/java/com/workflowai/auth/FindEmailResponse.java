package com.workflowai.auth;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

public record FindEmailResponse(
    @Schema(description = "마스킹된 이메일 목록. 일치 항목이 없으면 빈 배열")
    List<String> maskedEmails
) {
}
