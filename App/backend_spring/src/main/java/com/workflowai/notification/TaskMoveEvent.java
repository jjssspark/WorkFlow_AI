package com.workflowai.notification;

/**
 * version은 {@link com.workflowai.task.Task#getMoveVersion()} - 칸반 이동마다 DB에 저장되며
 * 1씩 증가하는 업무별 카운터다. 클라이언트가 SSE 도착 순서와 무관하게 최신 상태를 가려낼
 * 근거로 쓴다.
 *
 * epoch millis 같은 벽시계 타임스탬프를 쓰지 않는 이유: (1) OS 타이머 해상도 탓에 두 커밋이
 * 같은 밀리초를 캡처할 수 있어 동률이 생기고, (2) 시스템 시계가 NTP 등으로 보정되면 나중
 * 커밋이 더 작은 값을 받는 역행도 가능하다. 두 경우 모두 "동률/역전이면 버린다"와
 * "동률/역전이어도 적용한다" 중 어느 쪽을 골라도 다른 실패 사례가 남는다 - 애초에 시계에
 * 의존하지 않는 값이어야 한다. DB에 저장되는 정수 카운터는 그 문제가 없다.
 *
 * 호출자는 이 값을 반드시 트랜잭션 커밋 "이전"(비관적 잠금을 아직 쥐고 있는 시점, 즉
 * taskRepository.save() 직후)에 읽어서 넘겨야 한다 - moveTo()가 이미 그 시점에 카운터를
 * 증가시켜 두므로 별도 재조회 없이 task.getMoveVersion()을 그대로 쓰면 된다.
 */
public record TaskMoveEvent(String taskId, String projectId, String status, double position, long version) {
    public static TaskMoveEvent from(Long taskId, Long projectId, String status, double position, long version) {
        return new TaskMoveEvent(String.valueOf(taskId), String.valueOf(projectId), status, position, version);
    }
}
