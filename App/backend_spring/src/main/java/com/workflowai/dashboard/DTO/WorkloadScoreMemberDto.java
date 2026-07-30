package com.workflowai.dashboard.DTO;

import java.util.List;

public record WorkloadScoreMemberDto(
    String assignee_id,
    Integer task_count_total,
    Double completion_rate,
    Double overload_score,
    Boolean is_anomaly,
    List<String> anomaly_types,
    Double difficulty_score,
    Double workload_score,
    Double allocation_score,
    Double task_count_active_rel,
    Double task_count_total_rel,
    Double difficulty_total_rel,
    Integer overdue_count
) {}
