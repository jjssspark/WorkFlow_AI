package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * version은 호출자가 캡처해서 넘긴 값(Task.moveVersion)을 그대로 담아야 한다 - 클라이언트가
 * 뒤바뀐 도착 순서를 걸러낼 근거이기 때문이다(TaskMoveEvent 클래스 Javadoc 참고). from()이
 * 자체적으로 값을 다시 계산하거나 바꿔치기하면, 호출자({@link TaskController#updatePosition})가
 * moveTo() 직후(잠금을 쥔 시점)에 읽어 둔 정수 카운터가 무시되어 순서 보장이 깨진다.
 */
class TaskMoveEventTest {

    @Test
    void fromStringifiesIdsAndKeepsStatusPositionAndVersion() {
        TaskMoveEvent event = TaskMoveEvent.from(42L, 7L, "inprogress", 1.5, 3L);

        assertThat(event.taskId()).isEqualTo("42");
        assertThat(event.projectId()).isEqualTo("7");
        assertThat(event.status()).isEqualTo("inprogress");
        assertThat(event.position()).isEqualTo(1.5);
        assertThat(event.version()).isEqualTo(3L);
    }

    @Test
    void fromDoesNotRecomputeVersionItself() {
        // 호출자가 넘긴 version을 그대로 보존하는지 - "from()이 내부적으로 값을 다시 계산/치환한다"는
        // 회귀를 잡는다. 카운터이므로 0도 유효한 값이다(방금 생성된 업무는 아직 한 번도 안 옮겨졌다).
        long version = 0L;

        TaskMoveEvent event = TaskMoveEvent.from(1L, 1L, "todo", 0.0, version);

        assertThat(event.version()).isEqualTo(version);
    }
}
