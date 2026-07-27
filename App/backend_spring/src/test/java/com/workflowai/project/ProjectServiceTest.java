package com.workflowai.project;

import com.workflowai.dashboard.entity.Milestone;
import com.workflowai.dashboard.repository.MilestoneRepository;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.rag.RagIngestService;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;

@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock private ProjectRepository projectRepository;
    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private UserRepository userRepository;
    @Mock private TaskRepository taskRepository;
    @Mock private RagIngestService ragIngestService;
    @Mock private MilestoneRepository milestoneRepository;

    private ProjectService projectService;

    @BeforeEach
    void setUp() {
        TransactionOperations transactionOperations = new TransactionOperations() {
            @Override
            public <T> T execute(TransactionCallback<T> action) throws TransactionException {
                return action.doInTransaction(null);
            }
        };
        projectService = new ProjectService(
            projectRepository,
            projectMemberRepository,
            userRepository,
            taskRepository,
            milestoneRepository,
            transactionOperations,
            ragIngestService
        );
    }

    private CreateProjectRequest validRequest() {
        return new CreateProjectRequest(
            "스마트 주차 관리 시스템", "캡스톤디자인", "설명",
            LocalDate.of(2026, 3, 1), LocalDate.of(2026, 7, 18), null,
            6, List.of("발표자료", "보고서"), List.of("Spring Boot", "React"), "MVP 목표"
        );
    }

    @Test
    void create_savesProjectAndRegistersCreatorAsLeader() {
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());
        when(projectMemberRepository.countByProjectIdAndRoleNot(any(), any())).thenReturn(0L);

        ProjectResponse response = projectService.create(1L, validRequest());

        ArgumentCaptor<ProjectMember> memberCaptor = ArgumentCaptor.forClass(ProjectMember.class);
        verify(projectMemberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getUserId()).isEqualTo(1L);
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(ProjectRole.LEADER);
        assertThat(response.title()).isEqualTo("스마트 주차 관리 시스템");
        assertThat(response.inviteCode()).isNotBlank();
    }

    @Test
    void create_missingDeadline_isAllowedForBackwardCompatibility() {
        CreateProjectRequest request = new CreateProjectRequest(
            "제목", "캡스톤디자인", null, null, null, null, null, null, null, null
        );
        when(projectRepository.saveAndFlush(any(Project.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());
        when(projectMemberRepository.countByProjectIdAndRoleNot(any(), any())).thenReturn(0L);

        ProjectResponse response = projectService.create(1L, request);

        assertThat(response.deadline()).isNull();
    }

    @Test
    void create_startDateAfterDeadline_throws() {
        CreateProjectRequest request = new CreateProjectRequest(
            "제목", "캡스톤디자인", null,
            LocalDate.of(2026, 8, 1), LocalDate.of(2026, 7, 1), null,
            null, null, null, null
        );

        assertThatThrownBy(() -> projectService.create(1L, request))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void create_memberLimitLessThanOne_throws() {
        CreateProjectRequest request = new CreateProjectRequest(
            "제목", "캡스톤디자인", null, null, LocalDate.of(2026, 7, 1), null,
            0, null, null, null
        );

        assertThatThrownBy(() -> projectService.create(1L, request))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void find_computesMemberCountAndTaskProgressFromRealData() {
        Project project = new Project("제목", "캡스톤디자인", "설명");
        ReflectionTestUtils.setField(project, "id", 10L);
        when(projectRepository.findById(10L)).thenReturn(Optional.of(project));
        when(projectMemberRepository.countByProjectIdAndRoleNot(10L, ProjectRole.REVIEWER)).thenReturn(2L);
        Task done = new Task(10L, "a", "frontend", "완료", 1L, null, "medium", null, "MANUAL", null, 1L, 0.0);
        Task notDone = new Task(10L, "b", "frontend", "할 일", 1L, null, "medium", null, "MANUAL", null, 1L, 1.0);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of(done, notDone));

        ProjectResponse response = projectService.find(10L);

        assertThat(response.memberCount()).isEqualTo(2);
        assertThat(response.taskProgress()).isEqualTo(50);
    }

    @Test
    void find_noTasks_progressIsZero() {
        Project project = new Project("제목", "캡스톤디자인", "설명");
        ReflectionTestUtils.setField(project, "id", 10L);
        when(projectRepository.findById(10L)).thenReturn(Optional.of(project));
        when(projectMemberRepository.countByProjectIdAndRoleNot(10L, ProjectRole.REVIEWER)).thenReturn(0L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());

        ProjectResponse response = projectService.find(10L);

        assertThat(response.taskProgress()).isZero();
    }

    @Test
    void joinByCode_addsMemberWithMemberRole() {
        Project project = new Project("제목", "캡스톤디자인", "설명");
        when(projectRepository.findByInviteCode("AB12CD34")).thenReturn(Optional.of(project));
        when(projectMemberRepository.existsByProjectIdAndUserId(any(), any())).thenReturn(false);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());
        when(projectMemberRepository.countByProjectIdAndRoleNot(any(), any())).thenReturn(0L);

        projectService.joinByCode(5L, "ab12cd34");

        ArgumentCaptor<ProjectMember> memberCaptor = ArgumentCaptor.forClass(ProjectMember.class);
        verify(projectMemberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getUserId()).isEqualTo(5L);
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(ProjectRole.MEMBER);
    }

    @Test
    void joinByCode_invalidCode_throws() {
        when(projectRepository.findByInviteCode("BADCODE1")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectService.joinByCode(5L, "badcode1"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void finalizeEvaluation_setsEvalStatusToPublished() {
        Project project = new Project("제목", "캡스톤디자인", "설명");
        ReflectionTestUtils.setField(project, "id", 10L);
        ReflectionTestUtils.setField(project, "evalStatus", EvalStatus.EVALUATING);
        when(projectRepository.findById(10L)).thenReturn(Optional.of(project));
        when(projectMemberRepository.countByProjectIdAndRoleNot(10L, ProjectRole.REVIEWER)).thenReturn(2L);
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());

        ProjectResponse response = projectService.finalizeEvaluation(10L);

        assertThat(response.evalStatus()).isEqualTo("PUBLISHED");
        assertThat(project.getEvalStatus()).isEqualTo(EvalStatus.PUBLISHED);
    }

    @Test
    void finalizeEvaluation_projectNotFound_throws() {
        when(projectRepository.findById(999L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectService.finalizeEvaluation(999L))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void members_excludesReviewersFromTheTeamList() {
        ProjectMember leader = new ProjectMember(10L, 1L, ProjectRole.LEADER);
        ProjectMember reviewer = new ProjectMember(10L, 2L, ProjectRole.REVIEWER);
        when(projectMemberRepository.findAllByProjectId(10L)).thenReturn(List.of(leader, reviewer));
        User leaderUser = new User("leader@example.com", "허영주", "email", "leader");
        ReflectionTestUtils.setField(leaderUser, "id", 1L);
        when(userRepository.findAllById(List.of(1L))).thenReturn(List.of(leaderUser));

        List<MemberResponse> members = projectService.members(10L);

        assertThat(members).hasSize(1);
        assertThat(members.get(0).name()).isEqualTo("허영주");
    }

    @Test
    void delete_removesProjectRagSources() {
        projectService.delete(10L);

        verify(projectRepository).deleteById(10L);
        verify(ragIngestService).recordDeleteProjectIntent(10L);
        verify(ragIngestService).deleteProjectSourcesBestEffort(10L);
    }

    @Test
    void create_retriesWhenInviteCodeSaveCollisionOccurs() {
        when(projectRepository.saveAndFlush(any(Project.class)))
            .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint \"uq_projects_invite_code\""))
            .thenAnswer(invocation -> invocation.getArgument(0));
        when(taskRepository.findByProjectIdOrderByCreatedAtDesc(any())).thenReturn(List.of());
        when(projectMemberRepository.countByProjectIdAndRoleNot(any(), any())).thenReturn(0L);

        ProjectResponse response = projectService.create(1L, validRequest());

        assertThat(response.inviteCode()).isNotBlank();
        verify(projectRepository, org.mockito.Mockito.times(2)).saveAndFlush(any(Project.class));
    }

    @Test
    void update_rejectsRangeThatWouldExcludeExistingMilestone() {
        Project project = new Project("프로젝트", "team", LocalDate.of(2026, 8, 7), "");
        project.setStartDate(LocalDate.of(2026, 7, 1));
        ReflectionTestUtils.setField(project, "id", 1L);
        Milestone milestone = new Milestone(
            1L,
            "핵심기능 개발",
            LocalDate.of(2026, 7, 10),
            LocalDate.of(2026, 7, 31)
        );
        when(projectRepository.findById(1L)).thenReturn(Optional.of(project));
        when(milestoneRepository.findByProjectIdOrderByDueDateAsc(1L)).thenReturn(List.of(milestone));

        UpdateProjectRequest request = new UpdateProjectRequest(
            null, null, null, LocalDate.of(2026, 7, 15), null,
            null, null, null, null, null
        );

        assertThatThrownBy(() -> projectService.update(1L, request))
            .isInstanceOf(ProjectScheduleException.class)
            .hasMessageContaining("마일스톤 일정은 프로젝트 기간");
    }
}
