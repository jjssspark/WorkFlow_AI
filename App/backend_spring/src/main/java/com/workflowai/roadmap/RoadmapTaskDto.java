package com.workflowai.roadmap;

public record RoadmapTaskDto(
    String id,
    String milestoneId,
    String title,
    String category,
    String status,
    String assigneeId,
    String assigneeName,
    String startDate,
    String dueDate,
    String priority,
    String description,
    double position
) {
}
