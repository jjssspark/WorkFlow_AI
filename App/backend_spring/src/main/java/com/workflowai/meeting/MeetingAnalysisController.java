package com.workflowai.meeting;

import com.workflowai.common.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

// DONE: @projectAccess.isMember(#projectId)로 프로젝트 멤버십 검사 적용 완료 (2026-07-18).
@Tag(
    name = "회의록 AI",
    description = "회의록 업로드, AI 분석, 분석 결과 조회, To-Do 후보 승인 및 업무 등록 API"
)
@RestController
@RequestMapping("/api/v1/projects/{projectId}/meetings")
public class MeetingAnalysisController {
    private final MeetingAnalysisService meetingAnalysisService;

    public MeetingAnalysisController(MeetingAnalysisService meetingAnalysisService) {
        this.meetingAnalysisService = meetingAnalysisService;
    }

    @Operation(
        summary = "회의록 AI 분석 요청",
        description = "업로드된 회의록 파일 또는 텍스트를 저장하고 즉시 meetingId를 반환합니다. "
            + "실제 AI 분석(FastAPI 호출 또는 Spring fallback)은 백그라운드에서 실행되며, "
            + "상태는 GET /{meetingId} 또는 GET /{meetingId}/status로 조회합니다. "
            + "요청한 사용자가 해당 프로젝트 멤버가 아니면 403을 반환합니다."
    )
    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER') || @projectAccess.hasRole(#projectId, 'MEMBER')")
    public ResponseEntity<ApiResponse<MeetingAnalysisResponse>> analyze(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 원본 파일 (문서/음성)") @RequestPart(value = "file", required = false) MultipartFile file,
        @Parameter(description = "회의 제목", example = "7차 정기회의") @RequestParam(value = "title", required = false) String title,
        @Parameter(description = "회의 날짜 (YYYY-MM-DD)", example = "2026-07-09") @RequestParam(value = "meetingDate", required = false) String meetingDate,
        @Parameter(description = "회의 유형", example = "정기회의") @RequestParam(value = "meetingKind", required = false) String meetingKind,
        @Parameter(description = "업로드 파일 유형", example = "document", schema = @Schema(allowableValues = {"document", "audio"})) @RequestParam(value = "sourceType", required = false) String sourceType,
        @Parameter(description = "참석자 이름 목록 (attendeeIds가 없을 때만 사용되는 하위호환 경로)", example = "[\"김민준\", \"이서연\"]") @RequestParam(value = "participants", required = false) List<String> participants,
        @Parameter(description = "참석자 사용자 ID 목록 (프로젝트 멤버만 허용)", example = "[1, 2]") @RequestParam(value = "attendeeIds", required = false) List<Long> attendeeIds
    ) {
        try {
            return ResponseEntity.ok(ApiResponse.ok(meetingAnalysisService.analyze(
                projectId,
                file,
                title,
                meetingDate,
                meetingKind,
                sourceType,
                participants,
                attendeeIds
            )));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(400).body(ApiResponse.fail("INVALID_ATTENDEE", e.getMessage()));
        }
    }

    @Operation(
        summary = "회의록 목록 조회",
        description = "프로젝트에 등록된 회의록 목록을 최신순으로 조회합니다. 요청한 사용자가 해당 프로젝트 멤버가 아니면 403을 반환합니다."
    )
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<MeetingSummary>> getMeetings(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(meetingAnalysisService.findByProject(projectId));
    }

    @Operation(
        summary = "회의록 분석 결과/상태 조회",
        description = "회의록의 분석 상태(processing/completed/failed)와, 완료된 경우 분석 결과 및 To-Do 후보 목록을 조회합니다. "
            + "meetingId가 이 프로젝트 소속이 아니면 404를, 프로젝트 멤버가 아니면 403을 반환합니다."
    )
    @GetMapping("/{meetingId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<MeetingAnalysisResponse>> getMeeting(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "demo-project-1") @PathVariable String meetingId
    ) {
        MeetingAnalysisResponse response = meetingAnalysisService.find(projectId, meetingId);
        if (response == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록 분석 결과를 찾을 수 없습니다."));
        }
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(
        summary = "회의록 분석 상태 조회",
        description = "분석 결과 없이 상태(processing/completed/failed)와 실패 사유만 가볍게 조회합니다."
    )
    @GetMapping("/{meetingId}/status")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<MeetingStatusResponse>> getMeetingStatus(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "demo-project-1") @PathVariable String meetingId
    ) {
        MeetingStatusResponse response = meetingAnalysisService.findStatus(projectId, meetingId);
        if (response == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
        }
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(
        summary = "프로젝트 멤버 회의 참석 요약",
        description = "프로젝트 멤버별 회의 참석 횟수/전체 회의 수/참석률을 조회합니다. 기여도 화면의 회의 참여 지표로 사용됩니다."
    )
    @GetMapping("/attendance-summary")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<MeetingAttendanceSummary>> getAttendanceSummary(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        return ApiResponse.ok(meetingAnalysisService.attendanceSummary(projectId));
    }

    @Operation(
        summary = "팀원 회의 참석 상세",
        description = "특정 팀원의 회의별 참석/결석 여부와 날짜를 조회합니다. 기여도 화면의 회의 참여 드릴다운에 사용됩니다."
    )
    @GetMapping("/attendance-detail")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<MeetingAttendanceDetail>> getAttendanceDetail(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "조회할 팀원의 사용자 ID", example = "2") @RequestParam Long userId
    ) {
        return ApiResponse.ok(meetingAnalysisService.attendanceDetail(projectId, userId));
    }

    @Operation(
        summary = "회의록 삭제",
        description = "프로젝트에 업로드된 회의록을 삭제합니다. 팀장만 삭제할 수 있으며, 본인이 업로드하지 않은 회의록도 삭제할 수 있습니다. "
            + "회의록 원본 파일, 참석자 정보, AI 분석 결과, To-Do 후보가 함께 정리됩니다. "
            + "deleteLinkedTasks=true이면 업무보드에 등록된 연동 업무도 함께 삭제하고, false(기본값)이면 업무(meeting_action_items 등)는 유지한 채 원본 회의록 연결만 해제합니다. "
            + "meetingId가 이 프로젝트 소속이 아니면 404를, 팀장이 아니면 403을 반환합니다."
    )
    @DeleteMapping("/{meetingId}")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ResponseEntity<ApiResponse<MeetingDeleteResponse>> deleteMeeting(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "42") @PathVariable String meetingId,
        @Parameter(description = "업무보드에 등록된 연동 업무도 함께 삭제할지 여부", example = "false")
        @RequestParam(value = "deleteLinkedTasks", defaultValue = "false") boolean deleteLinkedTasks
    ) {
        MeetingDeleteResponse response = meetingAnalysisService.delete(projectId, meetingId, deleteLinkedTasks);
        if (response == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
        }
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(
        summary = "회의록 분석 결과 삭제",
        description = "회의록 원본(파일, 참석자 정보, transcript)은 남기고 AI 분석 결과(meeting_analysis, To-Do 후보)만 삭제합니다. "
            + "삭제 후 회의록은 분석 실패(failed) 상태로 전환되어 POST /{meetingId}/retry로 같은 파일을 재분석할 수 있습니다. "
            + "팀장만 삭제할 수 있습니다. deleteLinkedTasks=true이면 업무보드에 등록된 연동 업무도 함께 삭제하고, "
            + "false(기본값)이면 업무는 유지한 채 회의록 연결만 해제합니다. "
            + "meetingId가 이 프로젝트 소속이 아니면 404를, 팀장이 아니면 403을, 분석 결과가 없으면 409를 반환합니다."
    )
    @DeleteMapping("/{meetingId}/analysis")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ResponseEntity<ApiResponse<MeetingDeleteResponse>> deleteMeetingAnalysis(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "42") @PathVariable String meetingId,
        @Parameter(description = "업무보드에 등록된 연동 업무도 함께 삭제할지 여부", example = "false")
        @RequestParam(value = "deleteLinkedTasks", defaultValue = "false") boolean deleteLinkedTasks
    ) {
        try {
            MeetingDeleteResponse response = meetingAnalysisService.deleteAnalysis(projectId, meetingId, deleteLinkedTasks);
            if (response == null) {
                return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
            }
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(ApiResponse.fail("MEETING_ANALYSIS_NOT_FOUND", "삭제할 분석 결과가 없습니다."));
        }
    }

    @Operation(
        summary = "회의록 재분석 요청",
        description = "분석에 실패한(failed) 회의록을 processing 상태로 전환하고 백그라운드 분석을 재실행합니다."
    )
    @PostMapping("/{meetingId}/retry")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<ApiResponse<MeetingAnalysisResponse>> retryAnalysis(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "demo-project-1") @PathVariable String meetingId
    ) {
        try {
            MeetingAnalysisResponse response = meetingAnalysisService.retry(projectId, meetingId);
            if (response == null) {
                return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
            }
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(ApiResponse.fail("MEETING_NOT_FAILED", "분석 실패 상태의 회의록만 재시도할 수 있습니다."));
        }
    }

    @Operation(
        summary = "회의록 To-Do 업무 등록",
        description = "팀장이 승인한 회의록 기반 To-Do 후보를 실제 업무(Task)로 등록합니다. 등록된 업무는 업무보드와 대시보드에서 사용할 수 있습니다."
    )
    @PostMapping("/{meetingId}/tasks/register")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER')")
    public ResponseEntity<ApiResponse<TaskRegisterResponse>> registerTasks(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "demo-project-1") @PathVariable String meetingId,
        @RequestBody TaskRegisterRequest request
    ) {
        TaskRegisterResponse response = meetingAnalysisService.registerTasks(projectId, meetingId, request);
        if (response == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
        }
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(
        summary = "회의록 분석결과 저장 확정",
        description = "회의록 분석결과를 저장 확정한다. 팀장/팀원 모두 가능하며, 심사자는 접근할 수 없다."
    )
    @PostMapping("/{meetingId}/save")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER') || @projectAccess.hasRole(#projectId, 'MEMBER')")
    public ResponseEntity<ApiResponse<MeetingSaveResponse>> saveMeeting(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록 ID", example = "demo-project-1") @PathVariable String meetingId
    ) {
        MeetingSaveResponse response = meetingAnalysisService.confirmSave(projectId, meetingId);
        if (response == null) {
            return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
        }
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @Operation(
        summary = "회의록 수정본(버전) 생성",
        description = "원본을 훼손하지 않고 새 버전을 만든다. triggerAnalysis=false면 저장만, true면 저장 후 AI 재분석까지 수행한다. 팀장/팀원 모두 가능하며 심사자는 접근할 수 없다."
    )
    @PostMapping("/{meetingId}/versions")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER') || @projectAccess.hasRole(#projectId, 'MEMBER')")
    public ResponseEntity<ApiResponse<MeetingVersionResponse>> createVersion(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "원본 회의록 ID", example = "demo-project-1") @PathVariable String meetingId,
        @RequestBody MeetingVersionRequest request
    ) {
        try {
            MeetingVersionResponse response = meetingAnalysisService.createVersion(projectId, meetingId, request);
            if (response == null) {
                return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
            }
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(400).body(ApiResponse.fail("INVALID_TRANSCRIPT", e.getMessage()));
        } catch (DataIntegrityViolationException e) {
            // 다른 무결성 위반(FK 등)까지 제목 충돌로 은폐하지 않도록, DB가 보고한 제약 이름이
            // 유니크 인덱스와 정확히 일치할 때만 409로 응답한다. 오류 메시지 문자열 매칭은
            // DB·드라이버별 형식에 취약하므로, Hibernate가 구조적으로 파싱한 제약 이름을 사용한다.
            if ("uq_meetings_original_id_title".equals(constraintNameOf(e))) {
                return ResponseEntity.status(409).body(ApiResponse.fail("VERSION_TITLE_CONFLICT", "동시 수정 요청으로 버전 제목이 충돌했습니다. 다시 시도해주세요."));
            }
            throw e;
        }
    }

    @Operation(
        summary = "회의록 수정본(버전) 재분석",
        description = "이미 저장된 수정본(버전)을 새 버전 생성 없이 그 자리에서 재분석한다. "
            + "분석 대기(pending) 또는 분석 실패(failed) 상태의 버전에만 허용된다. 팀장/팀원 모두 가능하며 심사자는 접근할 수 없다."
    )
    @PostMapping("/{meetingId}/reanalyze")
    @PreAuthorize("@projectAccess.hasRole(#projectId, 'LEADER') || @projectAccess.hasRole(#projectId, 'MEMBER')")
    public ResponseEntity<ApiResponse<MeetingVersionResponse>> reanalyzeVersion(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId,
        @Parameter(description = "회의록(버전) ID", example = "demo-project-6") @PathVariable String meetingId
    ) {
        try {
            MeetingVersionResponse response = meetingAnalysisService.reanalyzeVersion(projectId, meetingId);
            if (response == null) {
                return ResponseEntity.status(404).body(ApiResponse.fail("MEETING_NOT_FOUND", "회의록을 찾을 수 없습니다."));
            }
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(400).body(ApiResponse.fail("NOT_A_VERSION", e.getMessage()));
        } catch (IllegalStateException e) {
            if (MeetingAnalysisService.MISSING_TRANSCRIPT_MESSAGE.equals(e.getMessage())) {
                return ResponseEntity.status(400).body(ApiResponse.fail("MISSING_TRANSCRIPT", e.getMessage()));
            }
            return ResponseEntity.status(409).body(ApiResponse.fail("MEETING_NOT_REANALYZABLE", "이미 분석 완료되었거나 분석 중인 회의록입니다."));
        }
    }

    private static String constraintNameOf(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException cve) {
                return cve.getConstraintName();
            }
        }
        return null;
    }
}
