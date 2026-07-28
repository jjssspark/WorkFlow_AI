package com.workflowai.notification;

public record TaskMoveEvent(String taskId, String projectId, String status, double position) {
    public static TaskMoveEvent from(Long taskId, Long projectId, String status, double position) {
        return new TaskMoveEvent(String.valueOf(taskId), String.valueOf(projectId), status, position);
    }
}
