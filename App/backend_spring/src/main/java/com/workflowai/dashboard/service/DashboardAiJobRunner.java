package com.workflowai.dashboard.service;

import com.workflowai.dashboard.DTO.WorkloadScoreResponseDto;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * DashboardAiQueueWorker가 큐에서 꺼낸 작업을 실제로 수행한다(FastAPI 위임 + 완료/실패 SSE 알림).
 * FastAPI 호출 실패는 여기서 삼킨다 — 대시보드는 실패해도 마지막 저장된 결과로 계속 떠 있어야
 * 하므로, 재분석 자체의 실패가 큐 재처리(retry)로 이어지지 않게 한다.
 */
@Component
public class DashboardAiJobRunner {
    private static final Logger log = LoggerFactory.getLogger(DashboardAiJobRunner.class);

    private static final String NOTIFICATION_TARGET_TYPE = "dashboard";
    private static final String DELAY_RISK_NOTIFICATION_TYPE = "DELAY_RISK_REFRESHED";
    private static final String WORKLOAD_SCORE_NOTIFICATION_TYPE = "WORKLOAD_SCORE_REFRESHED";

    private final FastApiDashboardClient fastApiDashboardClient;
    private final FastApiWorkloadScoreClient fastApiWorkloadScoreClient;
    private final DashboardWorkloadScoreCache workloadScoreCache;
    private final ProjectMemberRepository projectMemberRepository;
    private final NotificationService notificationService;

    public DashboardAiJobRunner(
        FastApiDashboardClient fastApiDashboardClient,
        FastApiWorkloadScoreClient fastApiWorkloadScoreClient,
        DashboardWorkloadScoreCache workloadScoreCache,
        ProjectMemberRepository projectMemberRepository,
        NotificationService notificationService
    ) {
        this.fastApiDashboardClient = fastApiDashboardClient;
        this.fastApiWorkloadScoreClient = fastApiWorkloadScoreClient;
        this.workloadScoreCache = workloadScoreCache;
        this.projectMemberRepository = projectMemberRepository;
        this.notificationService = notificationService;
    }

    public void runJob(DashboardAiJob job) {
        if (job.jobType() == DashboardAiJobType.DELAY_RISK) {
            runDelayRisk(job);
        } else {
            runWorkloadScore(job);
        }
    }

    private void runDelayRisk(DashboardAiJob job) {
        boolean success = true;
        try {
            fastApiDashboardClient.refreshDelayRisk(job.projectId());
        } catch (Exception exception) {
            success = false;
            log.warn("지연 위험도 재분석 실패. projectId={}", job.projectId(), exception);
        }
        notifyMembers(
            job,
            DELAY_RISK_NOTIFICATION_TYPE,
            success
                ? "ML 지연 위험도 재분석이 완료되었습니다."
                : "ML 지연 위험도 재분석에 실패했습니다. 잠시 후 다시 시도해주세요."
        );
    }

    private void runWorkloadScore(DashboardAiJob job) {
        boolean success = true;
        try {
            WorkloadScoreResponseDto result = fastApiWorkloadScoreClient.fetch(job.projectId());
            workloadScoreCache.put(job.projectId(), result);
        } catch (Exception exception) {
            success = false;
            log.warn("업무 편중 점수 계산 실패. projectId={}", job.projectId(), exception);
        }
        notifyMembers(
            job,
            WORKLOAD_SCORE_NOTIFICATION_TYPE,
            success
                ? "팀원별 업무 편중 점수 계산이 완료되었습니다."
                : "업무 편중 점수 계산에 실패했습니다. 잠시 후 다시 시도해주세요."
        );
    }

    /** 작업을 요청한 본인은 화면에서 폴링으로 직접 결과를 받으므로 제외하고, 나머지 팀원에게만 알린다. */
    private void notifyMembers(DashboardAiJob job, String type, String content) {
        String title = "대시보드 ML 분석 완료";
        projectMemberRepository.findAllByProjectId(job.projectId()).stream()
            .map(ProjectMember::getUserId)
            .filter(memberId -> !memberId.equals(job.requestedBy()))
            .forEach(memberId -> notificationService.notifyAfterCommit(
                memberId, job.projectId(), type, title, content, NOTIFICATION_TARGET_TYPE, null
            ));
    }
}
