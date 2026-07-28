package com.workflowai.notification;

/**
 * version은 브로드캐스트 시점(커밋 직후)의 벽시계 타임스탬프(epoch millis)다. 같은 업무를
 * 두 사용자가 거의 동시에 옮기면, DB 커밋은 비관적 잠금으로 순서가 보장되지만 그 이후 각
 * 요청 스레드가 커밋 후 콜백을 실행해 브로드캐스트하는 시점은 스레드 스케줄링에 달려 있어
 * 늦게 커밋된(=최신) 이벤트가 먼저 도착할 수 있다. version은 각 브로드캐스트가 실행되는
 * 실제 시각을 담으므로, 도착 순서가 뒤바뀌어도 수신 측이 "더 나중 시각"의 이벤트만 반영하면
 * 오래된 상태로 덮어써지지 않는다.
 */
public record TaskMoveEvent(String taskId, String projectId, String status, double position, long version) {
    public static TaskMoveEvent from(Long taskId, Long projectId, String status, double position) {
        return new TaskMoveEvent(
            String.valueOf(taskId), String.valueOf(projectId), status, position, System.currentTimeMillis()
        );
    }
}
