package com.workflowai.contribution;

public record ContributionMemberScoreDto(
    String assignee_id,
    Double workload_component,
    Double task_component,
    Double meeting_component,
    Double contribution_score,
    String anomaly_type,
    Double task_count_active_rel,
    Double task_count_total_rel,
    Double difficulty_avg_rel,
    Integer overdue_count
) {}
