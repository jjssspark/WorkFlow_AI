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

    static ProjectRole resolve(User user, ProjectRole invitedRole) {
        if (user != null && user.getReviewerStatus() == ReviewerStatus.APPROVED) {
            return ProjectRole.REVIEWER;
        }
        return invitedRole;
    }
}
