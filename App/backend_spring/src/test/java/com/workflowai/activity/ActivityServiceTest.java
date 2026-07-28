package com.workflowai.activity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ActivityServiceTest {

    @Mock
    private ActivityRepository activityRepository;

    @Mock
    private PlatformTransactionManager transactionManager;

    @Mock
    private TransactionStatus transactionStatus;

    @InjectMocks
    private ActivityService activityService;

    // record()가 TransactionTemplate(REQUIRES_NEW)으로 트랜잭션을 직접 관리하므로,
    // getTransaction()이 뭐라도 반환해야 execute 콜백까지 도달한다.
    @BeforeEach
    void setUp() {
        when(transactionManager.getTransaction(any())).thenReturn(transactionStatus);
    }

    @Test
    void record_savesActivityWithGivenFields() {
        activityService.record(1L, 7L, "TASK_CREATED", 10L, "'회원가입 API' 업무를 새로 추가했습니다.");

        ArgumentCaptor<Activity> captor = ArgumentCaptor.forClass(Activity.class);
        verify(activityRepository).save(captor.capture());
        Activity saved = captor.getValue();
        assertThat(saved.getProjectId()).isEqualTo(1L);
        assertThat(saved.getActorId()).isEqualTo(7L);
        assertThat(saved.getType()).isEqualTo("TASK_CREATED");
        assertThat(saved.getTargetId()).isEqualTo(10L);
        assertThat(saved.getMessage()).isEqualTo("'회원가입 API' 업무를 새로 추가했습니다.");
    }

    /**
     * 활동 기록은 평가 확정/점수 저장 같은 본 작업 화면 표시용 부가 데이터다. 저장이 실패했다고
     * 호출자(예: EvaluationScoreController.upsert())의 본 작업까지 실패로 되돌리면 안 된다.
     */
    @Test
    void record_swallowsExceptionWhenSaveFails() {
        when(activityRepository.save(any())).thenThrow(new RuntimeException("db down"));

        activityService.record(1L, 7L, "TASK_CREATED", 10L, "메시지");
    }
}
