package com.workflowai.admin.dto;

import com.workflowai.user.ReviewerStatus;
import java.time.LocalDateTime;

public record ReviewerApplicationSummary(
    Long userId,
    String name,
    String email,
    String affiliation,
    String facultyIdMasked,
    ReviewerStatus status,
    LocalDateTime createdAt,
    String rejectionReason
) {
}
