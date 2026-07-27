package com.workflowai.user;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.WorkFlowAiBackendApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@DataJpaTest
@ContextConfiguration(classes = WorkFlowAiBackendApplication.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class UserRepositoryReviewerStatusTest {

    @Autowired
    private UserRepository userRepository;

    @Test
    void findAllByReviewerStatusReturnsOnlyMatchingUsers() {
        User pending = userRepository.save(newReviewer("pending@example.com", ReviewerStatus.PENDING));
        userRepository.save(newReviewer("approved@example.com", ReviewerStatus.APPROVED));

        Page<User> result = userRepository.findAllByReviewerStatus(ReviewerStatus.PENDING, PageRequest.of(0, 20));

        assertThat(result.getContent()).extracting(User::getId).containsExactly(pending.getId());
    }

    @Test
    void approveIfPendingUpdatesWhenStatusMatches() {
        User user = userRepository.save(newReviewer("approve-me@example.com", ReviewerStatus.PENDING));

        int updated = userRepository.approveIfPending(user.getId());

        assertThat(updated).isEqualTo(1);
        assertThat(userRepository.findById(user.getId()).orElseThrow().getReviewerStatus())
            .isEqualTo(ReviewerStatus.APPROVED);
    }

    @Test
    void approveIfPendingReturnsZeroWhenAlreadyProcessed() {
        User user = userRepository.save(newReviewer("already-approved@example.com", ReviewerStatus.APPROVED));

        int updated = userRepository.approveIfPending(user.getId());

        assertThat(updated).isZero();
    }

    @Test
    void rejectIfPendingSavesReasonAndUpdatesStatus() {
        User user = userRepository.save(newReviewer("reject-me@example.com", ReviewerStatus.PENDING));

        int updated = userRepository.rejectIfPending(user.getId(), "서류 미비");

        assertThat(updated).isEqualTo(1);
        User reloaded = userRepository.findById(user.getId()).orElseThrow();
        assertThat(reloaded.getReviewerStatus()).isEqualTo(ReviewerStatus.REJECTED);
        assertThat(reloaded.getReviewerRejectionReason()).isEqualTo("서류 미비");
    }

    @Test
    void rejectIfPendingReturnsZeroWhenAlreadyProcessed() {
        User user = userRepository.save(newReviewer("already-rejected@example.com", ReviewerStatus.REJECTED));

        int updated = userRepository.rejectIfPending(user.getId(), "다시 거부");

        assertThat(updated).isZero();
    }

    private User newReviewer(String email, ReviewerStatus status) {
        User user = new User(email, "테스트", "local", email, "hash");
        user.setReviewerStatus(status);
        return user;
    }
}
