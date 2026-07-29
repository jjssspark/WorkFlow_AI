package com.workflowai.project;

import java.time.LocalDateTime;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InvitationService {
    private static final int EXPIRY_DAYS = 7;
    // 사이드바 "링크 복사"는 대상을 지정하지 않으므로 역할을 팀원으로 고정한다.
    private static final ProjectRole LINK_INVITE_ROLE = ProjectRole.MEMBER;

    private final InvitationRepository invitationRepository;
    private final ProjectMemberRepository projectMemberRepository;

    public InvitationService(InvitationRepository invitationRepository, ProjectMemberRepository projectMemberRepository) {
        this.invitationRepository = invitationRepository;
        this.projectMemberRepository = projectMemberRepository;
    }

    @Transactional
    public InvitationResponse create(Long projectId, CreateInvitationRequest request) {
        ProjectRole role = ProjectRole.fromKorean(request.role());
        Invitation invitation = invitationRepository.save(new Invitation(
            projectId,
            request.email(),
            role,
            UUID.randomUUID().toString(),
            LocalDateTime.now().plusDays(EXPIRY_DAYS)
        ));
        return toResponse(invitation);
    }

    // 클릭할 때마다 새 토큰을 발급하면 링크를 여러 번 복사한 사람마다 다른 초대가 쌓인다.
    // 아직 아무도 쓰지 않은(대기중, 미만료) 링크 초대가 있으면 그걸 그대로 재사용하고,
    // 없거나(처음이거나 이미 수락/만료됐으면) 새로 발급한다.
    @Transactional
    public InvitationResponse createLinkInvitation(Long projectId) {
        var existing = invitationRepository.findFirstByProjectIdAndEmailIsNullAndRoleAndStatusOrderByCreatedAtDesc(
            projectId, LINK_INVITE_ROLE, Invitation.Status.pending.name()
        );
        if (existing.isPresent()) {
            Invitation invitation = existing.get();
            if (!invitation.isExpired()) {
                return toResponse(invitation);
            }
            invitation.setStatus(Invitation.Status.expired.name());
        }

        Invitation invitation = invitationRepository.save(new Invitation(
            projectId,
            null,
            LINK_INVITE_ROLE,
            UUID.randomUUID().toString(),
            LocalDateTime.now().plusDays(EXPIRY_DAYS)
        ));
        return toResponse(invitation);
    }

    /**
     * 수락한 프로젝트의 id를 돌려준다. 호출자(프론트엔드)가 "방금 어디에 들어갔는지"를 추측하지
     * 않아도 되게 하기 위해서다 - 목록을 비교해 새 항목을 찾는 방식은 이미 그 프로젝트 멤버였던
     * 사람이 링크를 다시 썼을 때 새 항목이 없어 아무것도 고르지 못한다.
     */
    @Transactional
    public Long accept(String token, Long userId) {
        Invitation invitation = invitationRepository.findByToken(token)
            .orElseThrow(InvitationException::notFound);
        if (!invitation.isPending()) {
            throw InvitationException.alreadyProcessed();
        }
        if (invitation.isExpired()) {
            invitation.setStatus(Invitation.Status.expired.name());
            throw InvitationException.expired();
        }

        if (!projectMemberRepository.existsByProjectIdAndUserId(invitation.getProjectId(), userId)) {
            projectMemberRepository.save(new ProjectMember(invitation.getProjectId(), userId, invitation.getRole()));
        }
        invitation.setStatus(Invitation.Status.accepted.name());
        return invitation.getProjectId();
    }

    private InvitationResponse toResponse(Invitation invitation) {
        return new InvitationResponse(
            invitation.getProjectId(),
            invitation.getEmail(),
            invitation.getRole().toKorean(),
            invitation.getToken(),
            invitation.getStatus(),
            invitation.getExpiresAt()
        );
    }
}
