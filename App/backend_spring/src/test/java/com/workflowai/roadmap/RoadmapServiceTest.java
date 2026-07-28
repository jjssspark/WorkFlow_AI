package com.workflowai.roadmap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
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
import com.workflowai.security.UserPrincipal;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.InOrder;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
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

    /**
     * 기간이 정해지지 않은 프로젝트. ProjectSchedulePolicy는 프로젝트 시작일/마감일이 null이면
     * 아무것도 막지 않으므로, 일정 정책과 무관한 동작만 보고 싶을 때 쓴다.
     */
    private Project projectWithoutSchedule() {
        Project project = new Project("WorkFlow AI", "team", null, "설명");
        ReflectionTestUtils.setField(project, "id", 1L);
        return project;
    }

    private Milestone milestone(Long id, Long projectId, LocalDate startDate, LocalDate dueDate) {
        Milestone milestone = new Milestone(projectId, "단계 " + id, startDate, dueDate);
        ReflectionTestUtils.setField(milestone, "id", id);
        return milestone;
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

    /**
     * UT-137/UT-139. 로드맵 화면은 project·milestones·unassignedTasks 세 영역을 한 번에 받는다.
     * 특히 마일스톤에 연결되지 않은 업무는 "일정 미정" 그룹에만 나와야 하고, 마일스톤 안에 중복으로
     * 실리면 화면에 같은 업무가 두 번 보인다.
     */
    @Test
    void getRoadmapSplitsUnassignedTasksOutOfTheMilestoneGroups() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(milestone(2L, 1L)));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of(
            task(10L, 2L, "todo", 0.0),
            task(11L, null, "todo", 1.0),
            task(12L, null, "todo", 2.0)
        ));

        RoadmapResponse response = service().getRoadmap("1");

        assertThat(response.project().title()).isEqualTo("WorkFlow AI");
        assertThat(response.project().startDate()).isEqualTo("2026-07-01");
        assertThat(response.project().deadline()).isEqualTo("2026-08-07");
        assertThat(response.unassignedTasks()).extracting(RoadmapTaskDto::id).containsExactly("11", "12");
        // 미배정 업무가 마일스톤 안에 다시 실리면 화면에 같은 업무가 두 번 보인다.
        assertThat(response.milestones().get(0).tasks()).extracting(RoadmapTaskDto::id).containsExactly("10");
    }

    /**
     * UT-138. 시작일이 비어 있는 마일스톤은 맨 뒤로 보낸다. nullsLast를 빼면 정렬 중에 NPE가 나
     * 로드맵 화면 전체가 뜨지 않는다 - 마일스톤 하나의 날짜를 비워둔 것뿐인데 화면이 죽는 형태다.
     */
    @Test
    void getRoadmapSortsMilestonesByStartDateAndPushesUndatedOnesToTheEnd() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(
            milestone(3L, 1L, null, null),
            milestone(2L, 1L, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 5)),
            milestone(1L, 1L, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 10))
        ));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of());

        RoadmapResponse response = service().getRoadmap("1");

        assertThat(response.milestones()).extracting(RoadmapMilestoneDto::id).containsExactly("1", "2", "3");
    }

    /** UT-140. 3건 중 1건 완료는 33%다. 기존 테스트는 100%만 봐서 반올림이 어긋나도 드러나지 않는다. */
    @Test
    void milestoneProgressIsTheRoundedShareOfDoneTasks() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(milestone(2L, 1L)));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of(
            task(10L, 2L, "done", 0.0),
            task(11L, 2L, "todo", 1.0),
            task(12L, 2L, "inprogress", 2.0)
        ));

        RoadmapMilestoneDto milestone = service().getRoadmap("1").milestones().get(0);

        assertThat(milestone.taskCount()).isEqualTo(3);
        assertThat(milestone.doneCount()).isEqualTo(1);
        assertThat(milestone.progressPercent()).isEqualTo(33);
    }

    /** UT-141. 업무가 하나도 없는 마일스톤에서 0으로 나누면 로드맵 조회 자체가 500이 된다. */
    @Test
    void emptyMilestoneReportsZeroProgressInsteadOfDividingByZero() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(milestone(2L, 1L)));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of());

        RoadmapMilestoneDto milestone = service().getRoadmap("1").milestones().get(0);

        assertThat(milestone.taskCount()).isZero();
        assertThat(milestone.progressPercent()).isZero();
    }

    /** UT-142. 생성 성공 경로. 기존 테스트는 거부 경로만 있어 정상 생성이 깨져도 드러나지 않는다. */
    @Test
    void createMilestoneSavesAndReturnsAnEmptyMilestone() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.save(any()))
            .thenReturn(milestone(5L, 1L, LocalDate.of(2026, 7, 5), LocalDate.of(2026, 7, 20)));

        RoadmapMilestoneDto created = service().createMilestone(
            "1", new RoadmapMilestoneRequest("1차 릴리스", "2026-07-05", "2026-07-20")
        );

        assertThat(created.id()).isEqualTo("5");
        assertThat(created.startDate()).isEqualTo("2026-07-05");
        assertThat(created.dueDate()).isEqualTo("2026-07-20");
        assertThat(created.taskCount()).isZero();
        assertThat(created.progressPercent()).isZero();
    }

    /** UT-143. 공백 제목과 200자 경계. 경계 안쪽(200자)이 성공하는 것까지 봐야 상한이 확정된다. */
    @Test
    void createMilestoneRequiresATitleAndCapsItAtTwoHundredCharacters() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.save(any())).thenReturn(milestone(5L, 1L, null, null));

        assertThatThrownBy(() -> service().createMilestone("1", new RoadmapMilestoneRequest("   ", null, null)))
            .isInstanceOf(RoadmapException.class)
            .extracting(exception -> ((RoadmapException) exception).getCode())
            .isEqualTo("TITLE_REQUIRED");

        assertThatThrownBy(() -> service().createMilestone(
            "1", new RoadmapMilestoneRequest("가".repeat(201), null, null)
        )).isInstanceOf(RoadmapException.class)
            .extracting(exception -> ((RoadmapException) exception).getCode())
            .isEqualTo("TITLE_TOO_LONG");

        // 경계 안쪽은 통과해야 한다. 이 단정이 없으면 상한을 199로 낮춰도 위 두 개는 그대로 통과한다.
        assertThat(service().createMilestone("1", new RoadmapMilestoneRequest("가".repeat(200), null, null)))
            .isNotNull();
    }

    /** UT-144. YYYY-MM-DD가 아닌 문자열이 오면 파싱 예외가 그대로 새어 나가지 않고 400으로 바뀐다. */
    @Test
    void createMilestoneRejectsNonIsoDatesWithAnInvalidDateCode() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));

        assertThatThrownBy(() -> service().createMilestone(
            "1", new RoadmapMilestoneRequest("형식 오류", null, "2026/08/31")
        )).isInstanceOf(RoadmapException.class)
            .extracting(exception -> ((RoadmapException) exception).getCode())
            .isEqualTo("INVALID_DATE");

        verify(milestoneRepository, never()).save(any());
    }

    @Test
    void createMilestoneRejectsStartAfterDueDate() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));

        assertThatThrownBy(() -> service().createMilestone(
            "1", new RoadmapMilestoneRequest("잘못된 일정", "2026-07-20", "2026-07-10")
        )).isInstanceOf(RoadmapException.class)
            .hasMessageContaining("시작일은 마감일보다 늦을 수 없습니다")
            .extracting(exception -> ((RoadmapException) exception).getCode())
            .isEqualTo("INVALID_DATE_RANGE");
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

    /**
     * UT-148. 수정 응답은 변경값만이 아니라 연결 업무와 진행률을 다시 계산해 함께 내려준다.
     * 프론트가 이 응답으로 카드를 통째로 갈아끼우기 때문에, 연결 업무가 빠지면 화면에서 업무가 사라진다.
     */
    @Test
    void updateMilestoneReturnsItsLinkedTasksAndRecalculatedProgress() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        when(milestoneRepository.findById(2L)).thenReturn(Optional.of(milestone(2L, 1L)));
        when(taskRepository.findByProjectIdOrderByStatusAscPositionAsc(1L)).thenReturn(List.of(
            task(10L, 2L, "done", 0.0),
            task(11L, 2L, "todo", 1.0),
            task(12L, 3L, "todo", 2.0)
        ));

        RoadmapMilestoneDto updated = service().updateMilestone(
            "1", 2L, new RoadmapMilestoneRequest("1차 릴리스(수정)", "2026-07-05", "2026-07-20")
        );

        assertThat(updated.title()).isEqualTo("1차 릴리스(수정)");
        assertThat(updated.dueDate()).isEqualTo("2026-07-20");
        // 다른 마일스톤(3번)의 업무까지 끌어오면 진행률이 틀어진다.
        assertThat(updated.tasks()).extracting(RoadmapTaskDto::id).containsExactly("10", "11");
        assertThat(updated.progressPercent()).isEqualTo(50);
    }

    /**
     * UT-149. 프로젝트 id는 경로에서, 마일스톤 id는 본문에서 온다. 소속 검사를 빼면 남의 프로젝트
     * 마일스톤 id를 알아내는 것만으로 그 일정을 고칠 수 있다.
     */
    @Test
    void updateMilestoneRejectsAMilestoneOwnedByAnotherProject() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project()));
        Milestone otherProjectMilestone = milestone(99L, 2L);
        when(milestoneRepository.findById(99L)).thenReturn(Optional.of(otherProjectMilestone));

        assertThatThrownBy(() -> service().updateMilestone(
            "1", 99L, new RoadmapMilestoneRequest("가로채기", null, null)
        )).isInstanceOf(RoadmapException.class)
            .extracting(exception -> ((RoadmapException) exception).getCode())
            .isEqualTo("MILESTONE_NOT_FOUND");

        assertThat(otherProjectMilestone.getTitle()).isEqualTo("통합 테스트");
        verify(milestoneRepository, never()).save(any());
    }

    /** UT-151. 로드맵에서 제목만 입력해 만든 업무에 적용되는 기본값. */
    @Test
    void createTaskFillsRoadmapDefaultsWhenOnlyTheTitleIsGiven() {
        authenticateAs(7L);
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(projectWithoutSchedule()));
        when(milestoneRepository.findById(2L)).thenReturn(Optional.of(milestone(2L, 1L)));
        when(taskRepository.save(any())).thenAnswer(call -> call.getArgument(0));

        service().createTask("1", 2L, new RoadmapTaskCreateRequest(
            "API 구현", null, null, null, null, null
        ));

        Task saved = savedTask();
        assertThat(saved.getStatus()).isEqualTo("todo");
        assertThat(saved.getCategory()).isEqualTo("other");
        assertThat(saved.getPriority()).isEqualTo("medium");
        assertThat(saved.getSourceType()).isEqualTo("ROADMAP");
        assertThat(saved.getMilestoneId()).isEqualTo(2L);
    }

    /**
     * UT-152. 시작일을 비워두면 "오늘"을 쓰되 마일스톤 기간 밖으로는 나가지 않게 잘라낸다.
     *
     * <p>사전조건은 clock 고정이지만 {@code LocalDate.now()}를 주입할 자리가 없다. 대신 마일스톤
     * 기간을 오늘 기준 상대값으로 잡아, 어느 날 돌려도 같은 분기를 타게 만든다.
     */
    @Test
    void createTaskClampsTheDefaultStartDateIntoTheMilestoneWindow() {
        authenticateAs(7L);
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(projectWithoutSchedule()));
        when(taskRepository.save(any())).thenAnswer(call -> call.getArgument(0));

        LocalDate today = LocalDate.now();
        LocalDate futureStart = today.plusDays(10);
        when(milestoneRepository.findById(2L))
            .thenReturn(Optional.of(milestone(2L, 1L, futureStart, futureStart.plusDays(10))));

        service().createTask("1", 2L, new RoadmapTaskCreateRequest("아직 시작 전", null, null, null, null, null));
        assertThat(savedTask().getStartDate()).isEqualTo(futureStart);

        LocalDate pastDue = today.minusDays(10);
        when(milestoneRepository.findById(3L))
            .thenReturn(Optional.of(milestone(3L, 1L, pastDue.minusDays(10), pastDue)));

        service().createTask("1", 3L, new RoadmapTaskCreateRequest("이미 끝난 단계", null, null, null, null, null));
        assertThat(savedTask().getStartDate()).isEqualTo(pastDue);
    }

    /** UT-153. 새 업무는 같은 status 컬럼 맨 뒤로 간다. 컬럼이 비어 있으면 0부터 시작한다. */
    @Test
    void createTaskAppendsToTheEndOfItsStatusColumn() {
        authenticateAs(7L);
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectRepository.findById(1L)).thenReturn(Optional.of(projectWithoutSchedule()));
        when(milestoneRepository.findById(2L)).thenReturn(Optional.of(milestone(2L, 1L, null, null)));
        when(taskRepository.save(any())).thenAnswer(call -> call.getArgument(0));

        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(1L, "todo"))
            .thenReturn(Optional.of(task(9L, 2L, "todo", 2.0)));
        service().createTask("1", 2L, new RoadmapTaskCreateRequest("맨 뒤로", null, null, null, null, null));
        assertThat(savedTask().getPosition()).isEqualTo(3.0);

        when(taskRepository.findTopByProjectIdAndStatusOrderByPositionDesc(1L, "todo"))
            .thenReturn(Optional.empty());
        service().createTask("1", 2L, new RoadmapTaskCreateRequest("빈 컬럼", null, null, null, null, null));
        assertThat(savedTask().getPosition()).isEqualTo(0.0);
    }

    /** UT-154. 다른 마일스톤으로 옮기거나, null을 주어 "일정 미정"으로 내린다. */
    @Test
    void moveTaskChangesMilestoneAndAcceptsNullAsUnscheduled() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        Task task = task(10L, 2L, "todo", 0.0);
        when(taskRepository.findById(10L)).thenReturn(Optional.of(task));
        when(milestoneRepository.findById(4L)).thenReturn(Optional.of(milestone(4L, 1L)));

        assertThat(service().moveTask("1", 10L, new TaskMilestoneUpdateRequest(4L)).milestoneId()).isEqualTo("4");

        // null은 "마일스톤 없음"이라 존재 검사를 하지 않는다. 검사하면 일정 미정으로 못 내린다.
        assertThat(service().moveTask("1", 10L, new TaskMilestoneUpdateRequest(null)).milestoneId()).isNull();
        assertThat(task.getMilestoneId()).isNull();
    }

    /** UT-155. 다른 프로젝트의 업무 id로는 이동시킬 수 없다. */
    @Test
    void moveTaskRejectsATaskOwnedByAnotherProject() {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        Task otherProjectTask = task(10L, 2L, "todo", 0.0);
        ReflectionTestUtils.setField(otherProjectTask, "projectId", 2L);
        when(taskRepository.findById(10L)).thenReturn(Optional.of(otherProjectTask));

        assertThatThrownBy(() -> service().moveTask("1", 10L, new TaskMilestoneUpdateRequest(4L)))
            .isInstanceOf(RoadmapException.class)
            .extracting(exception -> ((RoadmapException) exception).getCode())
            .isEqualTo("TASK_NOT_FOUND");

        assertThat(otherProjectTask.getMilestoneId()).isEqualTo(2L);
        verify(taskRepository, never()).save(any());
    }

    /** 마지막으로 저장된 Task를 꺼낸다. 같은 테스트에서 여러 번 저장할 수 있으므로 매번 최신 것을 본다. */
    private Task savedTask() {
        ArgumentCaptor<Task> captor = ArgumentCaptor.forClass(Task.class);
        verify(taskRepository, atLeastOnce()).save(captor.capture());
        return captor.getValue();
    }

    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
        ));
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }
}
