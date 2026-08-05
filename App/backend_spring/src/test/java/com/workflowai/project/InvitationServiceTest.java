package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
    @Mock private ProjectJoinRole projectJoinRole;

    private InvitationService invitationService;

    @BeforeEach
    void setUp() {
        invitationService = new InvitationService(invitationRepository, projectJoinRole);
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
    void acceptDelegatesRoleAssignmentWithTheInvitedRole() {
        // 어떤 역할로 저장되는지는 ProjectJoinRoleTest가 본다. 여기서는 수락 흐름이
        // 초대에 적힌 역할을 그대로 넘기는지만 확인한다.
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));

        invitationService.accept("TOKEN", 9L);

        verify(projectJoinRole).assign(1L, 9L, ProjectRole.MEMBER);
        assertThat(invitation.getStatus()).isEqualTo(Invitation.Status.accepted.name());
    }

    @Test
    void acceptDoesNotConsumeTheInvitationWhenRoleAssignmentFails() {
        // 실패했는데 초대가 소진되면 정상 토큰이 아무 성과 없이 사라진다.
        Invitation invitation = new Invitation(1L, null, ProjectRole.MEMBER, "TOKEN", LocalDateTime.now().plusDays(3));
        when(invitationRepository.findByToken("TOKEN")).thenReturn(Optional.of(invitation));
        doThrow(new IllegalStateException("계정 없음")).when(projectJoinRole).assign(1L, 9L, ProjectRole.MEMBER);

        assertThatThrownBy(() -> invitationService.accept("TOKEN", 9L))
            .isInstanceOf(IllegalStateException.class);
        assertThat(invitation.getStatus()).isEqualTo(Invitation.Status.pending.name());
    }

}
