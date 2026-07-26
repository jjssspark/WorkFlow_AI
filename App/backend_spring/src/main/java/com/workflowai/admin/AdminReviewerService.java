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

    /** 관리자는 신청자 본인 확인을 위해 교수 식별번호를 그대로 볼 수 있어야 한다(마스킹 없음). */
    private ReviewerApplicationSummary toSummary(User user) {
        return new ReviewerApplicationSummary(
            user.getId(), user.getName(), user.getEmail(), user.getAffiliation(),
            user.getFacultyId(), user.getReviewerStatus(), user.getCreatedAt(),
            user.getReviewerRejectionReason()
        );
    }
}
