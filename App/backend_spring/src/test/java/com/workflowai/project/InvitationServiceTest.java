package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InvitationServiceTest {

    @Mock private InvitationRepository invitationRepository;
    @Mock private ProjectMemberRepository projectMemberRepository;
    @Mock private UserRepository userRepository;

    private InvitationService invitationService;

    @BeforeEach
    void setUp() {
        invitationService = new InvitationService(invitationRepository, projectMemberRepository, userRepository);
    }

    @Test
    void createLinkInvitationIssuesNewTokenWhenNoneExists() {
        when(invitationRepository.findFirstByProjectIdAndEmailIsNullAndRoleAndStatusOrderByCreatedAtDesc(
            eq(1L), eq(ProjectRole.MEMBER), eq(Invitation.Status.pending.name())
        )).thenReturn(Optional.empty());
        when(invitationRepository.save(any(Invitation.class))).thenAnswer(inv -> inv.getArgument(0));

        InvitationResponse response = invitationService.createLinkInvitation(1L);

        ArgumentCaptor<Invitation> captor = ArgumentCaptor.forClass(Invitation.class);
        verify(invitationRepository).save(captor.capture());
        assertThat(captor.getValue().getEmail()).isNull();
        assertThat(captor.getValue().getRole()).isEqualTo(ProjectRole.MEMBER);
        assertThat(response.role()).isEqualTo("팀원");
        assertThat(response.email()).isNull();
    }

    @Test
    void createLinkInvitationReusesExistingPendingUnexpiredToken() {
        Invitation existing = new Invitation(1L, null, ProjectRole.MEMBER, "EXISTING-TOKEN", LocalDateTime.now().plusDays(3));
        when(invitationRepository.findFirstByProjectIdAndEmailIsNullAndRoleAndStatusOrderByCreatedAtDesc(
            eq(1L), eq(ProjectRole.MEMBER), eq(Invitation.Status.pending.name())
        )).thenReturn(Optional.of(existing));

        InvitationResponse response = invitationService.createLinkInvitation(1L);

        assertThat(response.token()).isEqualTo("EXISTING-TOKEN");
        verify(invitationRepository, never()).save(any(Invitation.class));
    }

    @Test
    void createLinkInvitationIssuesNewTokenWhenExistingOneExpired() {
        Invitation expired = new Invitation(1L, null, ProjectRole.MEMBER, "EXPIRED-TOKEN", LocalDateTime.now().minusDays(1));
        when(invitationRepository.findFirstByProjectIdAndEmailIsNullAndRoleAndStatusOrderByCreatedAtDesc(
            eq(1L), eq(ProjectRole.MEMBER), eq(Invitation.Status.pending.name())
        )).thenReturn(Optional.of(expired));
        when(invitationRepository.save(any(Invitation.class))).thenAnswer(inv -> inv.getArgument(0));

        InvitationResponse response = invitationService.createLinkInvitation(1L);

        assertThat(expired.getStatus()).isEqualTo(Invitation.Status.expired.name());
        assertThat(response.token()).isNotEqualTo("EXPIRED-TOKEN");
        verify(invitationRepository).save(any(Invitation.class));
    }

    @Test
    void acceptAddsApprovedReviewerAsReviewerEvenWhenInviteSaysMember() {
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.empty());
        when(userRepository.findById(9L)).thenReturn(Optional.of(approvedReviewer()));

        invitationService.accept("TOKEN", 9L);

        ArgumentCaptor<ProjectMember> captor = ArgumentCaptor.forClass(ProjectMember.class);
        verify(projectMemberRepository).save(captor.capture());
        assertThat(captor.getValue().getRole()).isEqualTo(ProjectRole.REVIEWER);
    }

    @Test
    void acceptKeepsMemberRoleForNormalAccount() {
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.empty());
        when(userRepository.findById(9L)).thenReturn(Optional.of(normalUser()));

        invitationService.accept("TOKEN", 9L);

        ArgumentCaptor<ProjectMember> captor = ArgumentCaptor.forClass(ProjectMember.class);
        verify(projectMemberRepository).save(captor.capture());
        assertThat(captor.getValue().getRole()).isEqualTo(ProjectRole.MEMBER);
    }

    @Test
    void acceptWithUnknownUserThrowsInsteadOfJoiningWithTheInvitedRole() {
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));
        when(userRepository.findById(9L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> invitationService.accept("TOKEN", 9L))
            .isInstanceOf(IllegalStateException.class);
        // 실패했는데 초대가 소진되면 정상 토큰이 아무 성과 없이 사라진다.
        verify(projectMemberRepository, never()).save(any(ProjectMember.class));
        assertThat(invitation.getStatus()).isEqualTo(Invitation.Status.pending.name());
    }

    @Test
    void acceptUpgradesApprovedReviewerWhoWasAlreadyStoredAsTeamMember() {
        // 이 규칙이 생기기 전에 팀원으로 저장된 심사자를 재참여 시점에 바로잡는다.
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        ProjectMember stored = new ProjectMember(1L, 9L, ProjectRole.MEMBER);
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.of(stored));
        when(userRepository.findById(9L)).thenReturn(Optional.of(approvedReviewer()));

        invitationService.accept("TOKEN", 9L);

        assertThat(stored.getRole()).isEqualTo(ProjectRole.REVIEWER);
        verify(projectMemberRepository).save(stored);
    }

    @Test
    void acceptLeavesAnExistingLeaderAlone() {
        // 심사자 계정이 직접 만든 프로젝트의 팀장 자리를 빼앗으면 그 프로젝트를 관리할 사람이 없어진다.
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        ProjectMember leader = new ProjectMember(1L, 9L, ProjectRole.LEADER);
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 9L)).thenReturn(Optional.of(leader));
        when(userRepository.findById(9L)).thenReturn(Optional.of(approvedReviewer()));

        invitationService.accept("TOKEN", 9L);

        assertThat(leader.getRole()).isEqualTo(ProjectRole.LEADER);
        verify(projectMemberRepository, never()).save(any(ProjectMember.class));
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
