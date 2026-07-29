package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/**
 * moveVersion은 실시간 동기화(TaskMoveEvent)가 SSE 도착 순서와 무관하게 최신 상태를 가려낼
 * 근거이므로, moveTo() 호출마다 정확히 1씩만 증가하는지 확인한다. 이 증가가 실제로 일어나지
 * 않거나 두 번 이상 증가하면, 클라이언트의 "더 오래된 버전은 무시" 로직이 잘못된 판단을 내린다.
 */
class TaskTest {

    private Task newTask() {
        return new Task(
            1L, "제목", "frontend", "todo", 3L,
            LocalDate.of(2026, 7, 1), "medium", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void newlyCreatedTaskStartsAtMoveVersionZero() {
        assertThat(newTask().getMoveVersion()).isZero();
    }

    @Test
    void moveToIncrementsMoveVersionByOne() {
        Task task = newTask();

        task.moveTo("inprogress", 1.0);

        assertThat(task.getMoveVersion()).isEqualTo(1);
    }

    @Test
    void repeatedMovesAccumulateMoveVersion() {
        Task task = newTask();

        task.moveTo("inprogress", 1.0);
        task.moveTo("blocked", 2.0);
        task.moveTo("todo", 0.5);

        assertThat(task.getMoveVersion()).isEqualTo(3);
    }
}
