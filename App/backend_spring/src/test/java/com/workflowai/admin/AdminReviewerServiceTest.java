package com.workflowai.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workflowai.admin.dto.ReviewerApplicationSummary;
import com.workflowai.common.PageResponse;
import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

@ExtendWith(MockitoExtension.class)
class AdminReviewerServiceTest {

    @Mock
    private UserRepository userRepository;

    private AdminReviewerService adminReviewerService;

    @BeforeEach
    void setUp() {
        adminReviewerService = new AdminReviewerService(userRepository);
    }

    @Test
    void listApplications_masksFacultyId() {
        User user = new User("prof@example.com", "고교수", "local", "prof@example.com", "hash");
        user.setAffiliation("컴퓨터공학과");
        user.setFacultyId("PROF-2026-001");
        user.setReviewerStatus(ReviewerStatus.PENDING);
        when(userRepository.findAllByReviewerStatus(ReviewerStatus.PENDING, PageRequest.of(0, 20)))
            .thenReturn(new PageImpl<>(List.of(user)));

        PageResponse<ReviewerApplicationSummary> result =
            adminReviewerService.listApplications(ReviewerStatus.PENDING, PageRequest.of(0, 20));

        assertThat(result.items()).hasSize(1);
        ReviewerApplicationSummary summary = result.items().get(0);
        assertThat(summary.facultyIdMasked()).isNotEqualTo("PROF-2026-001");
        assertThat(summary.facultyIdMasked()).startsWith("PR");
        assertThat(summary.affiliation()).isEqualTo("컴퓨터공학과");
    }

    @Test
    void approve_pendingApplication_succeeds() {
        when(userRepository.approveIfPending(1L)).thenReturn(1);

        adminReviewerService.approve(1L);
    }

    @Test
    void approve_alreadyProcessed_throwsConflict() {
        when(userRepository.approveIfPending(1L)).thenReturn(0);

        assertThatThrownBy(() -> adminReviewerService.approve(1L))
            .isInstanceOf(ReviewerStatusConflictException.class);
    }

    @Test
    void reject_pendingApplication_succeeds() {
        when(userRepository.rejectIfPending(1L, "서류 미비")).thenReturn(1);

        adminReviewerService.reject(1L, "서류 미비");
    }

    @Test
    void reject_alreadyProcessed_throwsConflict() {
        when(userRepository.rejectIfPending(1L, "사유")).thenReturn(0);

        assertThatThrownBy(() -> adminReviewerService.reject(1L, "사유"))
            .isInstanceOf(ReviewerStatusConflictException.class);
    }
}
