package com.workflowai.project;

import com.workflowai.user.ReviewerStatus;
import com.workflowai.user.User;

/**
 * 초대를 수락한 사람에게 붙일 프로젝트 역할을 정한다.
 *
 * <p>링크 초대와 프로젝트 참여 코드는 대상을 지정하지 않고 발급되므로 역할이 팀원으로 고정돼
 * 있었다. 그래서 승인된 심사자 계정이 코드를 받아 들어오면 팀원으로 등록됐다. 심사자 계정은
 * 어떤 초대 경로로 들어와도 심사자여야 하므로, 계정 유형이 초대에 적힌 역할을 이긴다.
 */
final class ProjectJoinRole {
    private ProjectJoinRole() {
    }

    /**
     * @param user 참여자 계정. 인증을 통과한 userId로 조회하므로 null일 수 없다 - null이면
     *     역할 판단 근거가 없다는 뜻이라 팀원으로 넘기지 않고 터뜨린다.
     */
    static ProjectRole resolve(User user, ProjectRole invitedRole) {
        if (user == null) {
            throw new IllegalStateException("참여자 계정을 찾을 수 없어 프로젝트 역할을 정할 수 없습니다.");
        }
        return user.getReviewerStatus() == ReviewerStatus.APPROVED ? ProjectRole.REVIEWER : invitedRole;
    }

    /**
     * 이미 멤버인 사람의 역할을 바로잡아야 하는지 판단한다.
     *
     * <p>이 규칙이 생기기 전에 팀원으로 저장된 심사자를 재참여 시점에 고친다 - 마이그레이션
     * 없이 자연스럽게 백필하는 것이고, 팀장은 대상이 아니다(심사자 계정이 만든 프로젝트의
     * 팀장 자리를 빼앗아 그 프로젝트를 아무도 관리할 수 없게 만들면 안 된다).
     */
    static boolean needsRoleFix(ProjectMember existing, ProjectRole resolvedRole) {
        return resolvedRole == ProjectRole.REVIEWER && existing.getRole() == ProjectRole.MEMBER;
    }
}
