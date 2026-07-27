package com.workflowai.roadmap;

import com.workflowai.common.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "로드맵", description = "프로젝트 마일스톤과 연결 업무 관리 API")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/roadmap")
public class RoadmapController {
    private final RoadmapService roadmapService;

    public RoadmapController(RoadmapService roadmapService) {
        this.roadmapService = roadmapService;
    }

    @Operation(summary = "로드맵 조회")
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<RoadmapResponse> getRoadmap(@PathVariable String projectId) {
        return ApiResponse.ok(roadmapService.getRoadmap(projectId));
    }

    @Operation(summary = "마일스톤 생성")
    @PostMapping("/milestones")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<RoadmapMilestoneDto> createMilestone(
        @PathVariable String projectId,
        @RequestBody RoadmapMilestoneRequest request
    ) {
        return ApiResponse.ok(roadmapService.createMilestone(projectId, request));
    }

    @Operation(summary = "마일스톤 수정")
    @PatchMapping("/milestones/{milestoneId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<RoadmapMilestoneDto> updateMilestone(
        @PathVariable String projectId,
        @PathVariable Long milestoneId,
        @RequestBody RoadmapMilestoneRequest request
    ) {
        return ApiResponse.ok(roadmapService.updateMilestone(projectId, milestoneId, request));
    }

    @Operation(summary = "마일스톤 삭제", description = "연결 업무는 삭제하지 않고 일정 미정으로 이동합니다.")
    @DeleteMapping("/milestones/{milestoneId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ResponseEntity<ApiResponse<Void>> deleteMilestone(
        @PathVariable String projectId,
        @PathVariable Long milestoneId
    ) {
        roadmapService.deleteMilestone(projectId, milestoneId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @Operation(summary = "마일스톤 내부 업무 빠른 생성")
    @PostMapping("/milestones/{milestoneId}/tasks")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<RoadmapTaskDto> createTask(
        @PathVariable String projectId,
        @PathVariable Long milestoneId,
        @RequestBody RoadmapTaskCreateRequest request
    ) {
        return ApiResponse.ok(roadmapService.createTask(projectId, milestoneId, request));
    }

    @Operation(summary = "업무 소속 마일스톤 변경")
    @PatchMapping("/tasks/{taskId}/milestone")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<RoadmapTaskDto> moveTask(
        @PathVariable String projectId,
        @PathVariable Long taskId,
        @RequestBody TaskMilestoneUpdateRequest request
    ) {
        return ApiResponse.ok(roadmapService.moveTask(projectId, taskId, request));
    }

    @Operation(
        summary = "로드맵 업무 일괄 배치 변경",
        description = "다중 업무의 단계와 순서를 하나의 트랜잭션으로 변경합니다. 하나라도 유효하지 않으면 전체를 롤백합니다."
    )
    @PatchMapping("/tasks/layout")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ApiResponse<java.util.List<RoadmapTaskDto>> updateTaskLayout(
        @PathVariable String projectId,
        @RequestBody RoadmapTaskLayoutRequest request
    ) {
        return ApiResponse.ok(roadmapService.updateTaskLayout(projectId, request));
    }
}
