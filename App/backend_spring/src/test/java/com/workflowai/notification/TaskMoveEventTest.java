package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * version은 클라이언트가 뒤바뀐 도착 순서를 걸러낼 근거이므로, 실제로 호출마다 증가하는
 * 시각을 담는지 확인한다. {@link TaskController#updatePosition}이 같은 업무에 대한
 * 두 번째 브로드캐스트를 만들 때 이 값이 첫 번째보다 작거나 같으면, 클라이언트의
 * "더 오래된 이벤트 무시" 로직이 최신 이벤트까지 잘못 걸러낼 수 있다.
 */
class TaskMoveEventTest {

    @Test
    void fromStringifiesIdsAndKeepsStatusAndPosition() {
        TaskMoveEvent event = TaskMoveEvent.from(42L, 7L, "inprogress", 1.5);

        assertThat(event.taskId()).isEqualTo("42");
        assertThat(event.projectId()).isEqualTo("7");
        assertThat(event.status()).isEqualTo("inprogress");
        assertThat(event.position()).isEqualTo(1.5);
    }

    @Test
    void versionNeverGoesBackwardsAcrossSuccessiveCalls() throws InterruptedException {
        TaskMoveEvent first = TaskMoveEvent.from(1L, 1L, "todo", 0.0);
        Thread.sleep(2);
        TaskMoveEvent second = TaskMoveEvent.from(1L, 1L, "inprogress", 1.0);

        assertThat(second.version()).isGreaterThan(first.version());
    }
}
