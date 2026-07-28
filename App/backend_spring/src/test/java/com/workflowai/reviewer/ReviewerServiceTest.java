package com.workflowai.reviewer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workflowai.activity.Activity;
import com.workflowai.activity.ActivityRepository;
import com.workflowai.deliverable.DeliverableRepository;
import com.workflowai.github.GithubRecordRepository;
import com.workflowai.project.EvalStatus;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.task.TaskRepository;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class ReviewerServiceTest {

    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private UserRepository userRepository;
    @Mock private TaskRepository taskRepository;
    @Mock private DeliverableRepository deliverableRepository;
    @Mock private GithubRecordRepository githubRecordRepository;
    @Mock private ActivityRepository activityRepository;

    private ReviewerService reviewerService;

    @BeforeEach
    void setUp() {
        reviewerService = new ReviewerService(
            projectMemberRepository, projectRepository, userRepository,
            taskRepository, deliverableRepository, githubRecordRepository, activityRepository
        );
    }

    private static Project projectWithId(Long id, String title, String type, EvalStatus evalStatus) {
        Project project = new Project(title, type, null, "설명");
        ReflectionTestUtils.setField(project, "id", id);
        ReflectionTestUtils.setField(project, "evalStatus", evalStatus);
        return project;
    }

    private static User userWithId(Long id, String name) {
        User user = new User("user" + id + "@example.com", name, "local", "user" + id);
        ReflectionTestUtils.setField(user, "id", id);
        return user;
    }

    private record FakeTaskProgressView(Long getProjectId, Long getDoneCount, Long getTotalCount)
        implements TaskRepository.TaskProgressView {
    }

    @Test
    void getMyReviewProjects_returnsOnlyProjectsWhereCallerIsReviewer() {
        when(projectMemberRepository.findAllByUserId(9L)).thenReturn(List.of(
            new ProjectMember(1L, 9L, ProjectRole.LEADER),
            new ProjectMember(2L, 9L, ProjectRole.MEMBER),
            new ProjectMember(3L, 9L, ProjectRole.REVIEWER)
        ));
        when(projectRepository.findAllById(List.of(3L)))
            .thenReturn(List.of(projectWithId(3L, "실시간 버스 도착 알리미", "캡스톤디자인", EvalStatus.PENDING)));
        when(projectMemberRepository.findAllByProjectIdInAndRole(List.of(3L), ProjectRole.LEADER))
            .thenReturn(List.of(new ProjectMember(3L, 20L, ProjectRole.LEADER)));
        when(userRepository.findAllById(List.of(20L))).thenReturn(List.of(userWithId(20L, "이준혁")));
        when(projectMemberRepository.countMembersByProjectIds(List.of(3L))).thenReturn(List.of());
        when(taskRepository.summarizeProgressByProjectIds(List.of(3L), "done")).thenReturn(List.of());
        when(deliverableRepository.summarizeByProjectIds(List.of(3L), "final")).thenReturn(List.of());
        when(githubRecordRepository.findDistinctProjectIdsIn(List.of(3L))).thenReturn(List.of());

        List<ReviewerProjectSummary> result = reviewerService.getMyReviewProjects(9L);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).projectId()).isEqualTo(3L);
        assertThat(result.get(0).title()).isEqualTo("실시간 버스 도착 알리미");
        assertThat(result.get(0).leaderName()).isEqualTo("이준혁");
        assertThat(result.get(0).evalStatus()).isEqualTo("pending");
    }

    @Test
    void getMyReviewProjects_returnsEmptyListWhenCallerHasNoReviewerMembership() {
        when(projectMemberRepository.findAllByUserId(9L)).thenReturn(List.of(
            new ProjectMember(1L, 9L, ProjectRole.LEADER)
        ));

        List<ReviewerProjectSummary> result = reviewerService.getMyReviewProjects(9L);

        assertThat(result).isEmpty();
    }

    @Test
    void getMyReviewProjects_computesRoundedProgressPercentFromTaskSummary() {
        when(projectMemberRepository.findAllByUserId(9L))
            .thenReturn(List.of(new ProjectMember(3L, 9L, ProjectRole.REVIEWER)));
        when(projectRepository.findAllById(List.of(3L)))
            .thenReturn(List.of(projectWithId(3L, "실시간 버스 도착 알리미", "캡스톤디자인", EvalStatus.PENDING)));
        when(projectMemberRepository.findAllByProjectIdInAndRole(List.of(3L), ProjectRole.LEADER))
            .thenReturn(List.of());
        when(userRepository.findAllById(List.of())).thenReturn(List.of());
        when(projectMemberRepository.countMembersByProjectIds(List.of(3L))).thenReturn(List.of());
        when(taskRepository.summarizeProgressByProjectIds(List.of(3L), "done"))
            .thenReturn(List.of(new FakeTaskProgressView(3L, 8L, 9L)));
        when(deliverableRepository.summarizeByProjectIds(List.of(3L), "final")).thenReturn(List.of());
        when(githubRecordRepository.findDistinctProjectIdsIn(List.of(3L))).thenReturn(List.of());

        List<ReviewerProjectSummary> result = reviewerService.getMyReviewProjects(9L);

        // 8/9 = 88.88... -> 반올림 89
        assertThat(result.get(0).progressPercent()).isEqualTo(89);
    }

    @Test
    void getMyReviewProjects_marksGithubConnectedWhenRecordsExistForProject() {
        when(projectMemberRepository.findAllByUserId(9L))
            .thenReturn(List.of(new ProjectMember(3L, 9L, ProjectRole.REVIEWER)));
        when(projectRepository.findAllById(List.of(3L)))
            .thenReturn(List.of(projectWithId(3L, "실시간 버스 도착 알리미", "캡스톤디자인", EvalStatus.PENDING)));
        when(projectMemberRepository.findAllByProjectIdInAndRole(List.of(3L), ProjectRole.LEADER))
            .thenReturn(List.of());
        when(userRepository.findAllById(List.of())).thenReturn(List.of());
        when(projectMemberRepository.countMembersByProjectIds(List.of(3L))).thenReturn(List.of());
        when(taskRepository.summarizeProgressByProjectIds(List.of(3L), "done")).thenReturn(List.of());
        when(deliverableRepository.summarizeByProjectIds(List.of(3L), "final")).thenReturn(List.of());
        when(githubRecordRepository.findDistinctProjectIdsIn(List.of(3L))).thenReturn(List.of(3L));

        List<ReviewerProjectSummary> result = reviewerService.getMyReviewProjects(9L);

        assertThat(result.get(0).githubConnected()).isTrue();
    }

    @Test
    void getMyRecentActivities_returnsActivitiesWithProjectTitleAttached() {
        Activity activity = new Activity(3L, 9L, "GRADE_PUBLISHED", 20L, "김민준님의 학점을 공개했습니다.");
        ReflectionTestUtils.setField(activity, "id", 100L);
        ReflectionTestUtils.setField(activity, "createdAt", LocalDateTime.of(2026, 7, 28, 10, 0));
        when(activityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(eq(9L), any()))
            .thenReturn(List.of(activity));
        when(projectRepository.findAllById(List.of(3L)))
            .thenReturn(List.of(projectWithId(3L, "실시간 버스 도착 알리미", "캡스톤디자인", EvalStatus.PUBLISHED)));

        List<ReviewerActivityDto> result = reviewerService.getMyRecentActivities(9L);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo("100");
        assertThat(result.get(0).projectTitle()).isEqualTo("실시간 버스 도착 알리미");
        assertThat(result.get(0).message()).isEqualTo("김민준님의 학점을 공개했습니다.");
    }

    @Test
    void getMyRecentActivities_returnsEmptyListWhenNoActivities() {
        when(activityRepository.findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(eq(9L), any()))
            .thenReturn(List.of());

        List<ReviewerActivityDto> result = reviewerService.getMyRecentActivities(9L);

        assertThat(result).isEmpty();
    }

    private record FakeProjectLastAccessView(Long getProjectId, LocalDateTime getLastAccessedAt)
        implements ActivityRepository.ProjectLastAccessView {
    }

    @Test
    void getMyLastAccess_returnsLastAccessedAtPerProject() {
        LocalDateTime at = LocalDateTime.of(2026, 7, 28, 9, 30);
        when(activityRepository.findLastProjectAccessByActorId(9L))
            .thenReturn(List.of(new FakeProjectLastAccessView(3L, at)));

        List<ProjectLastAccessDto> result = reviewerService.getMyLastAccess(9L);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).projectId()).isEqualTo(3L);
        assertThat(result.get(0).lastAccessedAt()).isEqualTo("2026-07-28T09:30:00.000Z");
    }

    @Test
    void getMyLastAccess_returnsEmptyListWhenNoAccessRecorded() {
        when(activityRepository.findLastProjectAccessByActorId(9L)).thenReturn(List.of());

        List<ProjectLastAccessDto> result = reviewerService.getMyLastAccess(9L);

        assertThat(result).isEmpty();
    }
}
