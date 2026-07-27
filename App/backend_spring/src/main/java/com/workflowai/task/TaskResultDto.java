package com.workflowai.task;

import com.workflowai.common.UtcTimeFormat;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

@Schema(description = "업무 작업 내용 작성")
public record TaskResultDto(
    @Schema(description = "작업 내용") String content,
    @Schema(description = "마지막 수정 시각 (ISO-8601), 저장된 적 없으면 null") String updatedAt,
    @Schema(description = "관련 링크 목록") List<TaskResultLinkDto> links,
    @Schema(description = "첨부파일 목록") List<TaskResultFileDto> files
) {
    public static TaskResultDto empty(List<TaskResultLinkDto> links, List<TaskResultFileDto> files) {
        return new TaskResultDto("", null, links, files);
    }

    public static TaskResultDto from(TaskResult result, List<TaskResultLinkDto> links, List<TaskResultFileDto> files) {
        return new TaskResultDto(result.getContent(), UtcTimeFormat.toIsoUtc(result.getUpdatedAt()), links, files);
    }
}
