package com.workflowai.task;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Map;

@Schema(description = "업무 수정 요청 (부분 수정 - null 필드는 변경하지 않음)")
public record TaskUpdateRequest(
    @Schema(description = "업무 제목") String title,
    @Schema(description = "카테고리") String category,
    @Schema(description = "담당자 mock id(\"1\"~\"4\")") String assigneeId,
    @Schema(description = "시작일 (YYYY-MM-DD)") String startDate,
    @Schema(description = "마감일 (YYYY-MM-DD)") String dueDate,
    @Schema(description = "우선순위") String priority,
    @Schema(description = "업무 설명") String description,
    @Schema(description = "카테고리별 추가 정보(자유 키-값, 전체 교체)") Map<String, String> extraFields
) {}
