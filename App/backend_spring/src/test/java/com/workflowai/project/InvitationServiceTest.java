package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
    @Mock private ProjectMemberRepository projectMemberRepository;

    private InvitationService invitationService;

    @BeforeEach
    void setUp() {
        invitationService = new InvitationService(invitationRepository, projectMemberRepository);
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
}
