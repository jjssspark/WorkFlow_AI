package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class MeetingAnalysisControllerTest {

    @Mock
    private MeetingAnalysisService meetingAnalysisService;

    @Test
    void getMeetingsPassesProjectIdToService() throws Exception {
        when(meetingAnalysisService.findByProject("project-a")).thenReturn(List.of(
            new MeetingSummary("11", "A 프로젝트 회의", "2026-07-19", "정기회의", "completed", null, null, false, false)
        ));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/projects/project-a/meetings"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].meetingId").value("11"));

        verify(meetingAnalysisService).findByProject("project-a");
    }

    @Test
    void attendanceSummaryPassesProjectIdToService() throws Exception {
        when(meetingAnalysisService.attendanceSummary("project-a")).thenReturn(List.of(
            new MeetingAttendanceSummary(2L, "이서연", 1, 2, 50)
        ));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/projects/project-a/meetings/attendance-summary"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].userId").value(2))
            .andExpect(jsonPath("$.data[0].attendanceRate").value(50));

        verify(meetingAnalysisService).attendanceSummary("project-a");
    }

    @Test
    void attendanceDetailPassesProjectIdAndUserIdToService() throws Exception {
        when(meetingAnalysisService.attendanceDetail("project-a", 2L)).thenReturn(List.of(
            new MeetingAttendanceDetail("12", "12.10 팀 정기 회의", "2026-12-10", true)
        ));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/projects/project-a/meetings/attendance-detail").param("userId", "2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].meetingId").value("12"))
            .andExpect(jsonPath("$.data[0].attended").value(true));

        verify(meetingAnalysisService).attendanceDetail("project-a", 2L);
    }

    @Test
    void statusReturns404WhenMeetingMissing() throws Exception {
        when(meetingAnalysisService.findStatus("demo-project", "999")).thenReturn(null);
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/projects/demo-project/meetings/999/status"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("MEETING_NOT_FOUND"));
    }

    @Test
    void retryReturns409WhenMeetingIsNotFailed() throws Exception {
        when(meetingAnalysisService.retry("demo-project", "42")).thenThrow(new IllegalStateException("MEETING_NOT_FAILED"));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/42/retry"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("MEETING_NOT_FAILED"));
    }

    @Test
    void deleteReturns404WhenMeetingMissing() throws Exception {
        when(meetingAnalysisService.delete("demo-project", "999", false)).thenReturn(null);
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(delete("/api/v1/projects/demo-project/meetings/999"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("MEETING_NOT_FOUND"));
    }

    @Test
    void deleteReturnsDeletedStatus() throws Exception {
        when(meetingAnalysisService.delete("demo-project", "42", true)).thenReturn(new MeetingDeleteResponse("42", "DELETED"));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(delete("/api/v1/projects/demo-project/meetings/42").param("deleteLinkedTasks", "true"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.meetingId").value("42"))
            .andExpect(jsonPath("$.data.status").value("DELETED"));
    }

    @Test
    void saveMeetingReturns404WhenMeetingMissing() throws Exception {
        when(meetingAnalysisService.confirmSave("demo-project", "999")).thenReturn(null);
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/999/save"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("MEETING_NOT_FOUND"));
    }

    @Test
    void saveMeetingReturnsSavedStatus() throws Exception {
        when(meetingAnalysisService.confirmSave("demo-project", "42")).thenReturn(new MeetingSaveResponse("42", "SAVED"));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/42/save"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.meetingId").value("42"))
            .andExpect(jsonPath("$.data.status").value("SAVED"));

        verify(meetingAnalysisService).confirmSave("demo-project", "42");
    }

    @Test
    void createVersionReturns409OnlyWhenTitleUniqueConstraintViolated() throws Exception {
        when(meetingAnalysisService.createVersion(eq("demo-project"), eq("42"), any()))
            .thenThrow(new DataIntegrityViolationException(
                "insert failed",
                new ConstraintViolationException("constraint violation", null, "uq_meetings_original_id_title")
            ));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/42/versions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"transcript\":\"내용\",\"triggerAnalysis\":false}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("VERSION_TITLE_CONFLICT"));
    }

    @Test
    void createVersionPropagatesUnrelatedDataIntegrityViolation() {
        when(meetingAnalysisService.createVersion(eq("demo-project"), eq("42"), any()))
            .thenThrow(new DataIntegrityViolationException(
                "insert failed",
                new ConstraintViolationException("constraint violation", null, "fk_meetings_edited_by")
            ));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        assertThatThrownBy(() -> mockMvc.perform(post("/api/v1/projects/demo-project/meetings/42/versions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"transcript\":\"내용\",\"triggerAnalysis\":false}")))
            .hasCauseInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void createVersionPropagatesDataIntegrityViolationWithoutConstraintName() {
        // 드라이버가 제약 이름을 구조적으로 노출하지 못하는 경우, 안전하게 제목 충돌이 아닌 것으로 처리한다.
        when(meetingAnalysisService.createVersion(eq("demo-project"), eq("42"), any()))
            .thenThrow(new DataIntegrityViolationException("insert failed", new RuntimeException("unknown db error")));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        assertThatThrownBy(() -> mockMvc.perform(post("/api/v1/projects/demo-project/meetings/42/versions")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"transcript\":\"내용\",\"triggerAnalysis\":false}")))
            .hasCauseInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void reanalyzeReturns404WhenMeetingMissing() throws Exception {
        when(meetingAnalysisService.reanalyzeVersion("demo-project", "999")).thenReturn(null);
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/999/reanalyze"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("MEETING_NOT_FOUND"));
    }

    @Test
    void reanalyzeReturns400WhenNotAVersion() throws Exception {
        when(meetingAnalysisService.reanalyzeVersion("demo-project", "5"))
            .thenThrow(new IllegalArgumentException("원본 회의록은 재분석할 수 없습니다. 수정 후 다시 시도해주세요."));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/5/reanalyze"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("NOT_A_VERSION"));
    }

    @Test
    void reanalyzeReturns409WhenAlreadyCompleted() throws Exception {
        when(meetingAnalysisService.reanalyzeVersion("demo-project", "6"))
            .thenThrow(new IllegalStateException("MEETING_NOT_REANALYZABLE"));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/6/reanalyze"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error.code").value("MEETING_NOT_REANALYZABLE"));
    }

    @Test
    void reanalyzeReturnsProcessingStatus() throws Exception {
        when(meetingAnalysisService.reanalyzeVersion("demo-project", "6"))
            .thenReturn(new MeetingVersionResponse("6", "PROCESSING"));
        MeetingAnalysisController controller = new MeetingAnalysisController(meetingAnalysisService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(post("/api/v1/projects/demo-project/meetings/6/reanalyze"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.meetingId").value("6"))
            .andExpect(jsonPath("$.data.status").value("PROCESSING"));
    }
}
