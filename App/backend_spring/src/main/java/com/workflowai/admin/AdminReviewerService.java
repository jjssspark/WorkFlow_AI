package com.workflowai.admin;

import com.workflowai.admin.dto.ReviewerApplicationSummary;
import com.workflowai.common.PageResponse;
import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminReviewerService {
    private final UserRepository userRepository;

    public AdminReviewerService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public PageResponse<ReviewerApplicationSummary> listApplications(ReviewerStatus status, Pageable pageable) {
        return PageResponse.from(userRepository.findAllByReviewerStatus(status, pageable).map(this::toSummary));
    }

    @Transactional
    public void approve(Long userId) {
        int updated = userRepository.approveIfPending(userId);
        if (updated == 0) {
            throw new ReviewerStatusConflictException();
        }
    }

    @Transactional
    public void reject(Long userId, String reason) {
        int updated = userRepository.rejectIfPending(userId, reason);
        if (updated == 0) {
            throw new ReviewerStatusConflictException();
        }
    }

    private ReviewerApplicationSummary toSummary(User user) {
        return new ReviewerApplicationSummary(
            user.getId(), user.getName(), user.getEmail(), user.getAffiliation(),
            maskFacultyId(user.getFacultyId()), user.getReviewerStatus(), user.getCreatedAt(),
            user.getReviewerRejectionReason()
        );
    }

    /** 앞 2자/뒤 2자만 남기고 가운데를 가린다. 6자 이하는 전부 가린다. */
    private String maskFacultyId(String facultyId) {
        if (facultyId == null) {
            return null;
        }
        if (facultyId.length() <= 6) {
            return "*".repeat(facultyId.length());
        }
        return facultyId.substring(0, 2) + "*".repeat(facultyId.length() - 4) + facultyId.substring(facultyId.length() - 2);
    }
}
