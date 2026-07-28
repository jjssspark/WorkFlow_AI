package com.workflowai.dashboard.service;

/** requestedBy: 이 재분석/편중 계산을 트리거한 사용자 id. 완료 알림에서 "본인이 요청한 작업" 여부를 구분하는 데 쓴다. */
public record DashboardAiJob(String jobId, Long projectId, DashboardAiJobType jobType, Long requestedBy) {}
