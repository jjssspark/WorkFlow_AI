package com.workflowai.task;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

@Schema(description = "업무 목록 항목")
public record TaskListItem(
    @Schema(description = "업무 ID", example = "42") String id,
    @Schema(description = "소속 마일스톤 ID", example = "3") String milestoneId,
    @Schema(description = "업무 제목", example = "발표자료 초안 작성") String title,
    @Schema(description = "카테고리", example = "PRESENTATION") String category,
    @Schema(description = "상태", example = "todo", allowableValues = {"todo", "inprogress", "blocked", "done"}) String status,
    @Schema(description = "담당자 ID (미배정이면 null)", example = "1") String assigneeId,
    @Schema(description = "시작일 (YYYY-MM-DD)", example = "2026-07-10") String startDate,
    @Schema(description = "마감일 (YYYY-MM-DD)", example = "2026-07-15") String dueDate,
    @Schema(description = "우선순위", example = "HIGH") String priority,
    @Schema(description = "같은 status 안에서의 칸반 카드 순서(오름차순)", example = "0.0") double position,
    @Schema(description = "업무 설명", example = "로그인 성공/실패 케이스를 모두 처리한다.") String description,
    @Schema(description = "완료 승인 대기 중인지 여부(팀원이 완료를 요청했고 아직 팀장 승인/반려 전)", example = "false") boolean pendingApproval,
    @Schema(description = "카테고리별 추가 정보(자유 키-값)") Map<String, String> extraFields
) {
    public static TaskListItem from(Task task) {
        return new TaskListItem(
            String.valueOf(task.getId()),
            task.getMilestoneId() == null ? null : String.valueOf(task.getMilestoneId()),
            task.getTitle(),
            task.getCategory(),
            task.getStatus(),
            task.getAssigneeId() == null ? null : String.valueOf(task.getAssigneeId()),
            task.getStartDate() == null ? null : task.getStartDate().toString(),
            task.getDueDate() == null ? null : task.getDueDate().toString(),
            task.getPriority(),
            task.getPosition(),
            task.getDescription(),
            task.isPendingApproval(),
            task.getExtraFields() == null ? Map.of() : task.getExtraFields()
        );
    }
}
