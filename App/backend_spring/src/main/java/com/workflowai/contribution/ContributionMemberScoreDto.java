package com.workflowai.contribution;

import java.util.List;

public record ContributionMemberScoreDto(
    String assignee_id,
    Double workload_component,
    Double task_component,
    Double meeting_component,
    Double contribution_score,
    List<String> anomaly_types,
    Double difficulty_score,
    Double workload_score,
    Double allocation_score,
    Double task_count_active_rel,
    Double task_count_total_rel,
    Double difficulty_total_rel,
    Integer overdue_count
) {}
