package com.workflowai.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.workflowai.meeting.Meeting;
import com.workflowai.meeting.MeetingRepository;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class NotificationProjectResolverTest {

    @Mock
    private MeetingRepository meetingRepository;
    @Mock
    private TaskRepository taskRepository;
    @InjectMocks
    private NotificationProjectResolver resolver;

    private static Meeting meetingInProject(Long projectId) {
        return new Meeting(projectId, "회의록", "txt", "/tmp/a.txt", "completed", null, "정기회의", "a.txt", 1L, 10L);
    }

    private static Task taskInProject(Long projectId) {
        return new Task(projectId, "로그인 API", "개발", "todo", 1L, null, "high", null, "manual", null, 1L, 0);
    }

    @Test
    void resolvesMeetingNotificationToTheMeetingsProject() {
        when(meetingRepository.findById(12L)).thenReturn(Optional.of(meetingInProject(3L)));

        assertThat(resolver.resolve("meeting", 12L)).isEqualTo(3L);
    }

    @Test
    void resolvesTaskNotificationToTheTasksProject() {
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskInProject(8L)));

        assertThat(resolver.resolve("task", 42L)).isEqualTo(8L);
    }

    @Test
    void treatsTargetIdAsProjectIdForProjectScopedNotifications() {
        assertThat(resolver.resolve("project", 5L)).isEqualTo(5L);
        assertThat(resolver.resolve("evaluation", 5L)).isEqualTo(5L);
    }

    /** 회의록 전체 삭제처럼 대상 행이 이미 사라진 알림은 프로젝트를 되짚을 수 없다. */
    @Test
    void returnsNullWhenTheTargetRowIsGone() {
        when(meetingRepository.findById(99L)).thenReturn(Optional.empty());

        assertThat(resolver.resolve("meeting", 99L)).isNull();
    }

    @Test
    void returnsNullWhenThereIsNoTarget() {
        assertThat(resolver.resolve(null, null)).isNull();
        assertThat(resolver.resolve("project", null)).isNull();
        assertThat(resolver.resolve("unknown", 1L)).isNull();
    }
}
