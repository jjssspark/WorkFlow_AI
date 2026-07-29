package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * version은 호출자가 캡처해서 넘긴 값을 그대로 담아야 한다 - 클라이언트가 뒤바뀐 도착 순서를
 * 걸러낼 근거이기 때문이다(TaskMoveEvent 클래스 Javadoc 참고). from()이 자체적으로
 * System.currentTimeMillis()를 다시 계산해버리면, 호출자({@link TaskController#updatePosition})가
 * 커밋 이전(잠금을 쥔 시점)에 어렵게 캡처해 둔 값이 무시되고 콜백 실행 시각으로 덮어써져
 * 순서 보장이 깨진다.
 */
class TaskMoveEventTest {

    @Test
    void fromStringifiesIdsAndKeepsStatusPositionAndVersion() {
        TaskMoveEvent event = TaskMoveEvent.from(42L, 7L, "inprogress", 1.5, 12345L);

        assertThat(event.taskId()).isEqualTo("42");
        assertThat(event.projectId()).isEqualTo("7");
        assertThat(event.status()).isEqualTo("inprogress");
        assertThat(event.position()).isEqualTo(1.5);
        assertThat(event.version()).isEqualTo(12345L);
    }

    @Test
    void fromDoesNotRecomputeVersionItself() {
        // 호출자가 넘긴 version을 그대로 보존하는지 - 과거보다 더 이른 값을 넘겨도 바뀌지 않아야
        // "from()이 내부적으로 System.currentTimeMillis()를 다시 계산한다"는 회귀를 잡는다.
        long earlierVersion = System.currentTimeMillis() - 60_000;

        TaskMoveEvent event = TaskMoveEvent.from(1L, 1L, "todo", 0.0, earlierVersion);

        assertThat(event.version()).isEqualTo(earlierVersion);
    }
}
