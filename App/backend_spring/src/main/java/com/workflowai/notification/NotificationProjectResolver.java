package com.workflowai.notification;

import com.workflowai.meeting.Meeting;
import com.workflowai.meeting.MeetingRepository;
import com.workflowai.task.Task;
import com.workflowai.task.TaskRepository;
import org.springframework.stereotype.Component;

/**
 * 알림이 어느 프로젝트에 속하는지 알려준다. 클라이언트가 "지금 보고 있는 프로젝트의 알림"만
 * 띄우려면 이 값이 필요한데, notifications 테이블에는 project_id 컬럼이 없다. 컬럼을 새로 넣는
 * 대신 이미 저장된 targetType/targetId에서 매번 되짚는다 - 알림은 사용자당 최근 20건만 조회하므로
 * 조회 비용이 문제되지 않고, 마이그레이션 없이 기존 알림까지 곧바로 분류된다.
 *
 * 어느 프로젝트로도 환원되지 않으면(대상이 없는 알림, 이미 삭제된 회의록/업무 등) null을 준다.
 * 이 경우 클라이언트는 프로젝트와 무관한 알림으로 보고 그대로 띄운다 - 분류가 안 된다는 이유로
 * 알림을 삼키는 것보다, 화면과 무관할 수 있어도 보여주는 쪽이 안전하다.
 */
@Component
public class NotificationProjectResolver {
    private final MeetingRepository meetingRepository;
    private final TaskRepository taskRepository;

    public NotificationProjectResolver(MeetingRepository meetingRepository, TaskRepository taskRepository) {
        this.meetingRepository = meetingRepository;
        this.taskRepository = taskRepository;
    }

    public Long resolve(String targetType, Long targetId) {
        if (targetType == null || targetId == null) {
            return null;
        }
        return switch (targetType) {
            case "meeting" -> meetingRepository.findById(targetId).map(Meeting::getProjectId).orElse(null);
            case "task" -> taskRepository.findById(targetId).map(Task::getProjectId).orElse(null);
            // 평가/프로젝트 알림은 targetId 자체가 프로젝트 id다.
            case "evaluation", "project" -> targetId;
            default -> null;
        };
    }

    public Long resolve(Notification notification) {
        return resolve(notification.getTargetType(), notification.getTargetId());
    }
}
