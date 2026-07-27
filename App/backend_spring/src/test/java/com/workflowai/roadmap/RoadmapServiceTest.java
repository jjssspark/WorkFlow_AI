package com.workflowai.roadmap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.activity.ActivityService;
import com.workflowai.common.DemoDataService;
import com.workflowai.dashboard.entity.Milestone;
import com.workflowai.dashboard.repository.MilestoneRepository;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectRepository;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.InOrder;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class RoadmapServiceTest {
    @Mock private DemoDataService demoDataService;
    @Mock private ProjectRepository projectRepository;
    @Mock private MilestoneRepository milestoneRepository;
    @Mock private TaskRepository taskRepository;
    @Mock private UserRepository userRepository;
    @Mock private ActivityService activityService;

    private RoadmapService service() {
        return new RoadmapService(
            demoDataService, projectRepository, milestoneRepository,
            taskRepository, userRepository, activityService
        );
    }

    private Project project() {
        Project project = new Project("WorkFlow AI", "team", LocalDate.of(2026, 8, 7), "설명");
        ReflectionTestUtils.setField(project, "id", 1L);
        ReflectionTestUtils.setField(project, "startDate", LocalDate.of(2026, 7, 1));
        return project;
    }

    private Milestone milestone(Long id, Long projectId) {
        Milestone milestone = new Milestone(
            projectId, "통합 테스트", LocalDate.of(2026, 7, 17), LocalDate.of(2026, 7, 28)
        );
        ReflectionTestUtils.setField(milestone, "id", id);
        return milestone;
    }

    private Task task(Long id, Long milestoneId) {
        return task(id, milestoneId, "done", 0.0);
    }

    private Task task(Long id, Long milestoneId, String status, double position) {
        Task task = new Task(
            1L, milestoneId, "E2E 테스트 " + id, "qa", status, null,
            LocalDate.of(2026, 7, 21), LocalDate.of(2026, 7, 28),
            "medium", "로그인 성공과 실패 시나리오를 검증합니다.", "ROADMAP", null, 1L, position
        );
        ReflectionTestUtils.setField(task, "id", id);
        return task;
    }

    @Test
    void getRoadmapNestsTasksUnderTheirMilestone() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(milestone(2L, 1L)));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of(task(10L, 2L)));

        RoadmapResponse response = service().getRoadmap("1");

        assertThat(response.milestones()).hasSize(1);
        assertThat(response.milestones().get(0).startDate()).isEqualTo("2026-07-17");
        assertThat(response.milestones().get(0).tasks()).extracting(RoadmapTaskDto::id).containsExactly("10");
        assertThat(response.milestones().get(0).tasks().get(0).description())
            .isEqualTo("로그인 성공과 실패 시나리오를 검증합니다.");
        assertThat(response.milestones().get(0).progressPercent()).isEqualTo(100);
        assertThat(response.unassignedTasks()).isEmpty();
    }

    @Test
    void getRoadmapOrdersTasksInsideMilestoneByPositionAcrossStatuses() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(milestone(2L, 1L)));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of(
            task(11L, 2L, "todo", 2.0),
            task(10L, 2L, "done", 0.0)
        ));

        RoadmapResponse response = service().getRoadmap("1");

        assertThat(response.milestones().get(0).tasks())
            .extracting(RoadmapTaskDto::id)
            .containsExactly("10", "11");
    }

    @Test
    void createMilestoneRejectsStartAfterDueDate() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));

        assertThatThrownBy(() -> service().createMilestone(
            "1", new RoadmapMilestoneRequest("잘못된 일정", "2026-07-20", "2026-07-10")
        )).isInstanceOf(RoadmapException.class)
            .hasMessageContaining("시작일은 마감일보다 늦을 수 없습니다");
    }

    @Test
    void createMilestoneRejectsDatesOutsideProjectRange() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));

        assertThatThrownBy(() -> service().createMilestone(
            "1", new RoadmapMilestoneRequest("프로젝트 밖 단계", "2026-06-30", "2026-07-10")
        )).isInstanceOf(com.workflowai.project.ProjectScheduleException.class)
            .hasMessageContaining("프로젝트 기간");
    }

    @Test
    void moveTaskRejectsMilestoneFromAnotherProject() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(taskRepository.findById(10L)).thenReturn(Optional.of(task(10L, null)));
        when(milestoneRepository.findById(99L)).thenReturn(Optional.of(milestone(99L, 2L)));

        assertThatThrownBy(() -> service().moveTask("1", 10L, new TaskMilestoneUpdateRequest(99L)))
            .isInstanceOf(RoadmapException.class)
            .hasMessageContaining("마일스톤을 찾을 수 없습니다");
    }

    @Test
    void updateTaskLayoutMovesAndReordersTasksInOneTransaction() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        Task first = task(10L, 2L, "todo", 0.0);
        Task second = task(11L, 2L, "todo", 1.0);
        when(taskRepository.findAllById(any())).thenReturn(List.of(first, second));
        when(milestoneRepository.findAllById(any())).thenReturn(List.of(milestone(3L, 1L)));

        List<RoadmapTaskDto> result = service().updateTaskLayout("1", new RoadmapTaskLayoutRequest(List.of(
            new RoadmapTaskLayoutItem(10L, 3L, 1.0),
            new RoadmapTaskLayoutItem(11L, 3L, 0.0)
        )));

        assertThat(first.getMilestoneId()).isEqualTo(3L);
        assertThat(first.getPosition()).isEqualTo(1.0);
        assertThat(second.getMilestoneId()).isEqualTo(3L);
        assertThat(second.getPosition()).isEqualTo(0.0);
        assertThat(result).extracting(RoadmapTaskDto::id).containsExactly("10", "11");
        verify(taskRepository).saveAll(List.of(first, second));
    }

    @Test
    void updateTaskLayoutValidatesEveryTaskBeforeMutatingAnyTask() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        Task existing = task(10L, 2L, "todo", 0.0);
        when(taskRepository.findAllById(any())).thenReturn(List.of(existing));

        assertThatThrownBy(() -> service().updateTaskLayout("1", new RoadmapTaskLayoutRequest(List.of(
            new RoadmapTaskLayoutItem(10L, 3L, 1.0),
            new RoadmapTaskLayoutItem(99L, 3L, 0.0)
        )))).isInstanceOf(RoadmapException.class)
            .hasMessageContaining("업무를 찾을 수 없습니다");

        assertThat(existing.getMilestoneId()).isEqualTo(2L);
        assertThat(existing.getPosition()).isEqualTo(0.0);
        verify(taskRepository, never()).saveAll(any());
    }

    @Test
    void deleteMilestoneUnlinksTasksBeforeDeletingMilestone() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        Milestone milestone = milestone(2L, 1L);
        when(milestoneRepository.findById(2L)).thenReturn(Optional.of(milestone));

        service().deleteMilestone("1", 2L);

        InOrder deletionOrder = inOrder(taskRepository, milestoneRepository);
        deletionOrder.verify(taskRepository).clearMilestoneId(1L, 2L);
        deletionOrder.verify(milestoneRepository).delete(milestone);
    }
}
