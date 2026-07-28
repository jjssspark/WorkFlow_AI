package com.workflowai.notification;

/**
 * version은 실제 커밋 순서를 보존하는 벽시계 타임스탬프(epoch millis)여야 한다 - 반드시
 * 호출자가 트랜잭션 커밋 "이전"(비관적 잠금을 아직 쥐고 있는 시점, 즉 taskRepository.save()
 * 직후)에 캡처해서 넘겨야 한다.
 *
 * 커밋 "이후"(after-commit 콜백 안)에 캡처하면 안 된다. 같은 업무를 두 사용자가 거의 동시에
 * 옮기면 DB 커밋 자체는 비관적 잠금으로 순서가 보장되지만(A 커밋 → 잠금 해제 → B가 그제서야
 * 시작), 커밋 이후 콜백이 언제 스레드를 받아 실행되는지는 스레드 스케줄링에 달려 있다. A의
 * 콜백이 지연되는 사이 B가 자기 요청 전체(잠금 획득~커밋~콜백)를 먼저 끝내버리면, 나중에
 * 실행된 A의 캡처 시각이 B의 것보다 더 커져 정확히 역전된 순서를 만든다.
 *
 * 커밋 "이전", 잠금을 쥔 채로 캡처하면 이 문제가 없다 - B는 A가 커밋(=잠금 해제)하기 전까지
 * save()조차 호출할 수 없으므로, A의 캡처 시각은 B의 캡처 시각보다 항상 먼저다.
 */
public record TaskMoveEvent(String taskId, String projectId, String status, double position, long version) {
    public static TaskMoveEvent from(Long taskId, Long projectId, String status, double position, long version) {
        return new TaskMoveEvent(String.valueOf(taskId), String.valueOf(projectId), status, position, version);
    }
}
