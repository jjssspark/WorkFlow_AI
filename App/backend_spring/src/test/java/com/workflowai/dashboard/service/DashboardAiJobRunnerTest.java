package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestClientException;

@ExtendWith(MockitoExtension.class)
class DashboardAiJobRunnerTest {

    @Mock private FastApiDashboardClient fastApiDashboardClient;
    @Mock private FastApiWorkloadScoreClient fastApiWorkloadScoreClient;
    @Mock private DashboardWorkloadScoreCache workloadScoreCache;
    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private NotificationService notificationService;

    private DashboardAiJobRunner newRunner() {
        return new DashboardAiJobRunner(
            fastApiDashboardClient, fastApiWorkloadScoreClient, workloadScoreCache,
            projectMemberRepository, notificationService
        );
    }

    private DashboardAiJob job(DashboardAiJobType jobType) {
        return new DashboardAiJob("job-1", 7L, jobType, 5L);
    }

    @Test
    void delayRiskReturnsTrueWhenFastApiSucceeds() {
        when(projectMemberRepository.findAllByProjectId(7L)).thenReturn(List.of());

        assertThat(newRunner().runJob(job(DashboardAiJobType.DELAY_RISK))).isTrue();

        verify(fastApiDashboardClient).refreshDelayRisk(7L);
    }

    @Test
    void delayRiskReturnsFalseWhenFastApiFails() {
        // 실패를 삼킨 채 true를 돌려주면 워커가 완료 마커를 남겨, 프론트가 갱신되지 않은
        // 옛 ml_predictions를 새 분석 결과로 표시하게 된다.
        when(projectMemberRepository.findAllByProjectId(7L)).thenReturn(List.of());
        doThrowOnRefresh();

        assertThat(newRunner().runJob(job(DashboardAiJobType.DELAY_RISK))).isFalse();
    }

    @Test
    void workloadScoreReturnsFalseAndSkipsCacheWhenFastApiFails() {
        when(projectMemberRepository.findAllByProjectId(7L)).thenReturn(List.of());
        when(fastApiWorkloadScoreClient.fetch(7L)).thenThrow(new RestClientException("down"));

        assertThat(newRunner().runJob(job(DashboardAiJobType.WORKLOAD_SCORE))).isFalse();

        verify(workloadScoreCache, never()).put(anyLong(), any(WorkloadScoreResponseDto.class));
    }

    @Test
    void failureNotifiesOtherMembersWithFailureCopy() {
        when(projectMemberRepository.findAllByProjectId(7L)).thenReturn(List.of(member(5L), member(9L)));
        doThrowOnRefresh();

        newRunner().runJob(job(DashboardAiJobType.DELAY_RISK));

        ArgumentCaptor<String> content = ArgumentCaptor.forClass(String.class);
        // 요청자(5L)는 폴링으로 FAILED를 직접 받으므로 알림 대상에서 빠진다.
        verify(notificationService).notifyAfterCommit(
            eq(9L), eq(7L), eq("DELAY_RISK_REFRESHED"), anyString(), content.capture(), anyString(), any()
        );
        assertThat(content.getValue()).contains("실패");
    }

    private void doThrowOnRefresh() {
        org.mockito.Mockito.doThrow(new RestClientException("down"))
            .when(fastApiDashboardClient).refreshDelayRisk(7L);
    }

    private ProjectMember member(Long userId) {
        return new ProjectMember(7L, userId, ProjectRole.MEMBER);
    }
}
