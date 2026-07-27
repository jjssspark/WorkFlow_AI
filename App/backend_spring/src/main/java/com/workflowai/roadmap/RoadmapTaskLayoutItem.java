package com.workflowai.roadmap;

public record RoadmapTaskLayoutItem(
    Long taskId,
    Long milestoneId,
    double position
) {
}
