package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ProjectJoinRoleTest {

    @Mock private UserRepository userRepository;
    @Mock private ProjectMemberRepository projectMemberRepository;

    private ProjectJoinRole projectJoinRole;

    @BeforeEach
    void setUp() {
        projectJoinRole = new ProjectJoinRole(userRepository, projectMemberRepository);
    }

    @Test
    void approvedReviewerJoinsAsReviewerEvenWhenTheInviteSaysMember() {
        givenUser(approvedReviewer());
        givenNoExistingMembership();

        projectJoinRole.assign(1L, 9L, ProjectRole.MEMBER);

        assertThat(savedMember().getRole()).isEqualTo(ProjectRole.REVIEWER);
    }

    @Test
    void approvedReviewerJoinsAsReviewerEvenWhenTheInviteSaysLeader() {
        // 심사자 계정은 열람 전용이다. 팀장으로 들어오면 프로젝트 수정·삭제 권한을 갖게 된다.
        givenUser(approvedReviewer());
        givenNoExistingMembership();

        projectJoinRole.assign(1L, 9L, ProjectRole.LEADER);

        assertThat(savedMember().getRole()).isEqualTo(ProjectRole.REVIEWER);
    }

    @Test
    void normalAccountKeepsTheInvitedRole() {
        givenUser(normalUser());
        givenNoExistingMembership();

        projectJoinRole.assign(1L, 9L, ProjectRole.MEMBER);

        assertThat(savedMember().getRole()).isEqualTo(ProjectRole.MEMBER);
    }

    @Test
    void reviewerStoredAsTeamMemberBeforeThisRuleIsFixedOnRejoin() {
        ProjectMember stored = new ProjectMember(1L, 9L, ProjectRole.MEMBER);
        givenUser(approvedReviewer());
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.of(stored));

        projectJoinRole.assign(1L, 9L, ProjectRole.MEMBER);

        assertThat(stored.getRole()).isEqualTo(ProjectRole.REVIEWER);
        verify(projectMemberRepository).save(stored);
    }

    @Test
    void anExistingLeaderIsLeftAlone() {
        // 심사자 계정이 직접 만든 프로젝트의 팀장 자리를 빼앗으면 관리할 사람이 없어진다.
        ProjectMember leader = new ProjectMember(1L, 9L, ProjectRole.LEADER);
        givenUser(approvedReviewer());
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.of(leader));

        projectJoinRole.assign(1L, 9L, ProjectRole.MEMBER);

        assertThat(leader.getRole()).isEqualTo(ProjectRole.LEADER);
        verify(projectMemberRepository, never()).save(any(ProjectMember.class));
    }

    @Test
    void anExistingMemberRejoiningIsNotRewritten() {
        ProjectMember stored = new ProjectMember(1L, 9L, ProjectRole.MEMBER);
        givenUser(normalUser());
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.of(stored));

        projectJoinRole.assign(1L, 9L, ProjectRole.MEMBER);

        assertThat(stored.getRole()).isEqualTo(ProjectRole.MEMBER);
        verify(projectMemberRepository, never()).save(any(ProjectMember.class));
    }

    @Test
    void anUnknownAccountThrowsInsteadOfJoiningWithTheInvitedRole() {
        // 인증을 통과한 userId인데 계정이 없다면 데이터가 깨진 것이다. 초대 역할로 넣고 넘어가면
        // 그 불일치가 정상 참여로 묻힌다. IllegalArgumentException이면 안 된다 - ProjectController가
        // 그걸 잡아 400 INVALID_INVITE_CODE로 바꾸므로 "코드가 틀렸다"로 위장된다.
        when(userRepository.findById(9L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> projectJoinRole.assign(1L, 9L, ProjectRole.MEMBER))
            .isInstanceOf(IllegalStateException.class);
        verify(projectMemberRepository, never()).save(any(ProjectMember.class));
    }

    private void givenUser(User user) {
        when(userRepository.findById(9L)).thenReturn(Optional.of(user));
    }

    private void givenNoExistingMembership() {
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.empty());
    }

    private ProjectMember savedMember() {
        ArgumentCaptor<ProjectMember> captor = ArgumentCaptor.forClass(ProjectMember.class);
        verify(projectMemberRepository).save(captor.capture());
        return captor.getValue();
    }

    private User approvedReviewer() {
        User user = normalUser();
        user.setReviewerStatus(ReviewerStatus.APPROVED);
        return user;
    }

    private User normalUser() {
        return new User("user@example.com", "홍길동", "local", "user@example.com", "hash");
    }
}
