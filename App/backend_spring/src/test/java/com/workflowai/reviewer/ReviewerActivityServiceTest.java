package com.workflowai.reviewer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.project.Project;
import com.workflowai.project.ProjectRepository;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ReviewerActivityServiceTest {

    @Mock
    private ReviewerActivityRepository reviewerActivityRepository;

    @Mock
    private ProjectRepository projectRepository;

    @Mock
    private PlatformTransactionManager transactionManager;

    @Mock
    private TransactionStatus transactionStatus;

    @InjectMocks
    private ReviewerActivityService reviewerActivityService;

    // record()가 TransactionTemplate(REQUIRES_NEW)으로 트랜잭션을 직접 관리하므로,
    // getTransaction()이 뭐라도 반환해야 execute 콜백까지 도달한다.
    @BeforeEach
    void setUp() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
    }

    private Project projectWith(long id, String title) {
        Project project = new Project(title, "캡스톤디자인", null);
        ReflectionTestUtils.setField(project, "id", id);
        return project;
    }

    private ReviewerActivity activityWith(long projectId, ReviewerActivityType type, LocalDateTime createdAt) {
        ReviewerActivity activity = new ReviewerActivity(1L, projectId, type);
        ReflectionTestUtils.setField(activity, "createdAt", createdAt);
        return activity;
    }

    private ReviewerActivityRepository.ProjectLastAccessView lastAccessView(long projectId, LocalDateTime at) {
        return new ReviewerActivityRepository.ProjectLastAccessView() {
            @Override
            public Long getProjectId() {
                return projectId;
            }

            @Override
            public LocalDateTime getLastAccessedAt() {
                return at;
            }
        };
    }

    @Test
    void 활동을_기록하면_사용자_프로젝트_종류가_그대로_저장된다() {
        reviewerActivityService.record(7L, 3L, ReviewerActivityType.EVALUATION_FINALIZED);

        ArgumentCaptor<ReviewerActivity> captor = ArgumentCaptor.forClass(ReviewerActivity.class);
        verify(reviewerActivityRepository).save(captor.capture());
        assertThat(captor.getValue().getUserId()).isEqualTo(7L);
        assertThat(captor.getValue().getProjectId()).isEqualTo(3L);
        assertThat(captor.getValue().getActivityType()).isEqualTo(ReviewerActivityType.EVALUATION_FINALIZED);
    }

    /**
     * 활동 기록은 홈 화면 표시용 부가 데이터다. 저장이 실패했다고 평가 확정 같은 본 작업까지
     * 실패로 되돌리면 안 된다.
     */
    @Test
    void 기록_저장이_실패해도_예외를_던지지_않는다() {
        when(reviewerActivityRepository.save(any())).thenThrow(new RuntimeException("db down"));

        reviewerActivityService.record(7L, 3L, ReviewerActivityType.PROJECT_ACCESS);
    }

    @Test
    void 최근_활동에_프로젝트_제목과_표시_문구가_채워진다() {
        LocalDateTime at = LocalDateTime.of(2026, 7, 28, 9, 30);
        when(reviewerActivityRepository.findAllByUserIdOrderByCreatedAtDescIdDesc(any(), any()))
            .thenReturn(List.of(activityWith(3L, ReviewerActivityType.PROJECT_ACCESS, at)));
        when(reviewerActivityRepository.findLastAccessByUserId(1L)).thenReturn(List.of());
        when(projectRepository.findAllById(anyList())).thenReturn(List.of(projectWith(3L, "스마트 주차 관리 시스템")));

        ReviewerActivityHomeResponse response = reviewerActivityService.getHomeActivities(1L);

        assertThat(response.activities()).hasSize(1);
        assertThat(response.activities().get(0).projectTitle()).isEqualTo("스마트 주차 관리 시스템");
        assertThat(response.activities().get(0).activityType()).isEqualTo("PROJECT_ACCESS");
        assertThat(response.activities().get(0).activityLabel()).isEqualTo("프로젝트 접속");
        assertThat(response.activities().get(0).createdAt()).isEqualTo(at);
    }

    /** 프로젝트가 지워져도 "언제 무엇을 했는지"는 카드에 계속 보여야 한다. */
    @Test
    void 프로젝트가_삭제되어도_활동_줄이_사라지지_않는다() {
        when(reviewerActivityRepository.findAllByUserIdOrderByCreatedAtDescIdDesc(any(), any()))
            .thenReturn(List.of(activityWith(99L, ReviewerActivityType.EVALUATION_FINALIZED, LocalDateTime.now())));
        when(reviewerActivityRepository.findLastAccessByUserId(1L)).thenReturn(List.of());
        when(projectRepository.findAllById(anyList())).thenReturn(List.of());

        ReviewerActivityHomeResponse response = reviewerActivityService.getHomeActivities(1L);

        assertThat(response.activities()).hasSize(1);
        assertThat(response.activities().get(0).projectTitle()).isEqualTo("삭제된 프로젝트");
    }

    @Test
    void 프로젝트별_마지막_접속_시각이_함께_내려간다() {
        LocalDateTime at = LocalDateTime.of(2026, 7, 27, 14, 0);
        when(reviewerActivityRepository.findAllByUserIdOrderByCreatedAtDescIdDesc(any(), any())).thenReturn(List.of());
        when(reviewerActivityRepository.findLastAccessByUserId(1L)).thenReturn(List.of(lastAccessView(5L, at)));
        when(projectRepository.findAllById(anyList())).thenReturn(List.of());

        ReviewerActivityHomeResponse response = reviewerActivityService.getHomeActivities(1L);

        assertThat(response.lastAccess()).hasSize(1);
        assertThat(response.lastAccess().get(0).projectId()).isEqualTo(5L);
        assertThat(response.lastAccess().get(0).lastAccessedAt()).isEqualTo(at);
    }

    @Test
    void 활동_기록이_없으면_두_목록_모두_비어있다() {
        when(reviewerActivityRepository.findAllByUserIdOrderByCreatedAtDescIdDesc(any(), any())).thenReturn(List.of());
        when(reviewerActivityRepository.findLastAccessByUserId(1L)).thenReturn(List.of());
        when(projectRepository.findAllById(anyList())).thenReturn(List.of());

        ReviewerActivityHomeResponse response = reviewerActivityService.getHomeActivities(1L);

        assertThat(response.activities()).isEmpty();
        assertThat(response.lastAccess()).isEmpty();
    }
}
