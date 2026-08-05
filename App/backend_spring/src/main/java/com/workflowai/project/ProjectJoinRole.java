package com.workflowai.project;

import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import org.springframework.stereotype.Component;

/**
 * 초대를 수락한 사람을 프로젝트 멤버로 붙인다. 참여 경로(링크 초대 / 프로젝트 참여 코드)마다
 * 따로 판단하지 않게 규칙을 여기 한 곳에 둔다.
 *
 * <p>두 경로 모두 대상을 지정하지 않고 발급되므로 초대에 적히는 역할이 팀원으로 고정돼 있었고,
 * 그래서 승인된 심사자 계정이 코드를 받아 들어오면 팀원으로 등록됐다. 심사자 계정은 어떤
 * 경로로 들어와도 심사자여야 하므로 계정 유형이 초대에 적힌 역할을 이긴다.
 */
@Component
class ProjectJoinRole {
    private final UserRepository userRepository;
    private final ProjectMemberRepository projectMemberRepository;

    ProjectJoinRole(UserRepository userRepository, ProjectMemberRepository projectMemberRepository) {
        this.userRepository = userRepository;
        this.projectMemberRepository = projectMemberRepository;
    }

    /**
     * 이미 멤버면 역할이 틀어진 경우만 바로잡고, 아니면 새로 등록한다.
     *
     * @param invitedRole 초대에 적힌 역할. 심사자 계정이면 무시된다.
     * @throws IllegalStateException 계정을 찾을 수 없을 때. 인증을 통과한 userId로 조회하므로
     *     없다는 건 데이터 불일치이고, 초대 역할로 넘겨버리면 그 불일치가 정상 참여로 묻힌다.
     */
    void assign(Long projectId, Long userId, ProjectRole invitedRole) {
        User user = userRepository.findById(userId).orElseThrow(() ->
            new IllegalStateException("참여자 계정을 찾을 수 없어 프로젝트 역할을 정할 수 없습니다."));
        ProjectRole role = user.getReviewerStatus() == ReviewerStatus.APPROVED
            ? ProjectRole.REVIEWER
            : invitedRole;

        projectMemberRepository.findByProjectIdAndUserId(projectId, userId).ifPresentOrElse(
            existing -> {
                if (needsRoleFix(existing, role)) {
                    existing.setRole(role);
                    projectMemberRepository.save(existing);
                }
            },
            () -> projectMemberRepository.save(new ProjectMember(projectId, userId, role))
        );
    }

    /**
     * 이 규칙이 생기기 전에 팀원으로 저장된 심사자를 재참여 시점에 고친다 - 마이그레이션 없이
     * 자연스럽게 백필하는 것이다. 팀장은 대상이 아니다: 심사자 계정이 만든 프로젝트의 팀장
     * 자리를 빼앗으면 그 프로젝트를 관리할 사람이 없어진다.
     */
    private static boolean needsRoleFix(ProjectMember existing, ProjectRole resolvedRole) {
        return resolvedRole == ProjectRole.REVIEWER && existing.getRole() == ProjectRole.MEMBER;
    }
}
