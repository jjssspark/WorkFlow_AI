package com.workflowai.task;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.UserPrincipal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TaskResultController.class)
@AutoConfigureMockMvc(addFilters = false)
class TaskResultControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TaskResultRepository taskResultRepository;

    @MockitoBean
    private TaskResultLinkRepository taskResultLinkRepository;

    @MockitoBean
    private TaskResultFileRepository taskResultFileRepository;

    @MockitoBean
    private TaskRepository taskRepository;

    @MockitoBean
    private DemoDataService demoDataService;

    @MockitoBean
    private SupabaseStorageClient storageClient;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    // 실제 요청에서는 JwtAuthenticationFilter가 이 인증 정보를 채운다. 이 인증 컨텍스트만이
    // CurrentUser.id()의 유일한 근거이므로, 클라이언트가 보내는 값(예전의 userId 파라미터)으로는
    // 더 이상 담당자 신분을 흉내낼 수 없다는 것을 이 테스트들이 검증한다.
    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    private Task taskWithAssignee(Long assigneeId) {
        return new Task(
            1L, "API 명세 확정", "backend", "inprogress", assigneeId,
            LocalDate.of(2026, 7, 1), "high", "설명",
            "MANUAL", null, 1L, 0.0
        );
    }

    @Test
    void getResultReturnsEmptyWhenNoneSaved() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultRepository.findByTaskId(42L)).thenReturn(Optional.empty());
        when(taskResultLinkRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());
        when(taskResultFileRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());

        mockMvc.perform(get("/api/v1/projects/demo-project/tasks/42/result"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.content").value(""))
            .andExpect(jsonPath("$.data.updatedAt").doesNotExist());
    }

    @Test
    void returnsNotFoundWhenTaskMissing() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(999L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/projects/demo-project/tasks/999/result"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error.code").value("TASK_NOT_FOUND"));
    }

    @Test
    void assigneeCanSaveContent() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultRepository.findByTaskId(42L)).thenReturn(Optional.empty());
        when(taskResultRepository.save(any(TaskResult.class))).thenAnswer(inv -> inv.getArgument(0));
        when(taskResultLinkRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());
        when(taskResultFileRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());

        mockMvc.perform(put("/api/v1/projects/demo-project/tasks/42/result")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"API 명세 초안을 작성했습니다."}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.content").value("API 명세 초안을 작성했습니다."));
    }

    @Test
    void leaderCanSaveContentForSomeoneElsesTask() throws Exception {
        authenticateAs(1L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 1L))
            .thenReturn(Optional.of(new ProjectMember(1L, 1L, ProjectRole.LEADER)));
        when(taskResultRepository.findByTaskId(42L)).thenReturn(Optional.empty());
        when(taskResultRepository.save(any(TaskResult.class))).thenAnswer(inv -> inv.getArgument(0));
        when(taskResultLinkRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());
        when(taskResultFileRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());

        mockMvc.perform(put("/api/v1/projects/demo-project/tasks/42/result")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"팀장이 대신 정리"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.content").value("팀장이 대신 정리"));
    }

    @Test
    void saveResultRejectsNullContent() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);

        mockMvc.perform(put("/api/v1/projects/demo-project/tasks/42/result")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("CONTENT_REQUIRED"));

        verify(taskResultRepository, never()).save(any());
    }

    @Test
    void saveResultRejectsContentOverMaxLength() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        String hugeContent = "a".repeat(2001);

        mockMvc.perform(put("/api/v1/projects/demo-project/tasks/42/result")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"" + hugeContent + "\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("CONTENT_TOO_LONG"));

        verify(taskResultRepository, never()).save(any());
    }

    @Test
    void saveResultRetriesAsUpdateWhenConcurrentInsertWinsRace() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        TaskResult concurrentlyCreated = new TaskResult(42L, "다른 요청이 먼저 만든 내용");
        when(taskResultRepository.findByTaskId(42L))
            .thenReturn(Optional.empty())
            .thenReturn(Optional.of(concurrentlyCreated));
        when(taskResultRepository.save(any(TaskResult.class)))
            .thenThrow(new DataIntegrityViolationException("unique violation"))
            .thenAnswer(inv -> inv.getArgument(0));
        when(taskResultLinkRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());
        when(taskResultFileRepository.findByTaskIdOrderByCreatedAtAsc(42L)).thenReturn(List.of());

        mockMvc.perform(put("/api/v1/projects/demo-project/tasks/42/result")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"내가 쓴 내용으로 갱신"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.content").value("내가 쓴 내용으로 갱신"));

        verify(taskResultRepository, times(2)).save(any(TaskResult.class));
    }

    @Test
    void nonAssigneeCannotSaveContent() throws Exception {
        authenticateAs(9L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));

        mockMvc.perform(put("/api/v1/projects/demo-project/tasks/42/result")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"제가 대신 씁니다"}
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_ASSIGNEE"));

        verify(taskResultRepository, never()).save(any());
    }

    @Test
    void assigneeCanAddLink() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultLinkRepository.save(any(TaskResultLink.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/result/links")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"url":"https://github.com/teamflow-ai/backend/pull/42","title":"PR #42"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.title").value("PR #42"))
            .andExpect(jsonPath("$.data.url").value("https://github.com/teamflow-ai/backend/pull/42"));
    }

    @Test
    void nonAssigneeCannotAddLink() throws Exception {
        authenticateAs(9L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/result/links")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"url":"https://x.com/y","title":"제목"}
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_ASSIGNEE"));

        verify(taskResultLinkRepository, never()).save(any());
    }

    @Test
    void addLinkRejectsNonHttpScheme() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/result/links")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"url":"javascript:alert(1)","title":"악성 링크"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("URL_INVALID_SCHEME"));

        verify(taskResultLinkRepository, never()).save(any());
    }

    @Test
    void addLinkRejectsHttpSchemeUrlWithoutHost() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/result/links")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"url":"http:///no-host","title":"호스트 없는 URL"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("URL_INVALID_SCHEME"));

        verify(taskResultLinkRepository, never()).save(any());
    }

    @Test
    void addLinkRejectsUrlOverMaxLength() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        String hugeUrl = "https://x.com/" + "a".repeat(2000);

        mockMvc.perform(post("/api/v1/projects/demo-project/tasks/42/result/links")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"url\":\"" + hugeUrl + "\",\"title\":\"제목\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("URL_TOO_LONG"));

        verify(taskResultLinkRepository, never()).save(any());
    }

    @Test
    void assigneeCanDeleteLink() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultLinkRepository.findById(7L)).thenReturn(Optional.of(new TaskResultLink(42L, "https://x.com", "제목")));

        mockMvc.perform(delete("/api/v1/projects/demo-project/tasks/42/result/links/7"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void assigneeCanUploadFile() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultFileRepository.save(any(TaskResultFile.class))).thenAnswer(inv -> inv.getArgument(0));
        MockMultipartFile file = new MockMultipartFile("file", "meeting_result.pdf", "application/pdf", "hello".getBytes());

        mockMvc.perform(multipart("/api/v1/projects/demo-project/tasks/42/result/files")
                .file(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.fileName").value("meeting_result.pdf"));

        verify(storageClient).upload(anyString(), any(), anyLong(), eq("application/pdf"));
    }

    @Test
    void uploadFileSanitizesPathTraversalInOriginalFileName() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultFileRepository.save(any(TaskResultFile.class))).thenAnswer(inv -> inv.getArgument(0));
        MockMultipartFile file = new MockMultipartFile(
            "file", "../../etc/passwd", "text/plain", "hello".getBytes()
        );

        mockMvc.perform(multipart("/api/v1/projects/demo-project/tasks/42/result/files")
                .file(file))
            .andExpect(status().isOk());

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(storageClient).upload(pathCaptor.capture(), any(), anyLong(), eq("text/plain"));
        String storagePath = pathCaptor.getValue();
        assertThat(storagePath).doesNotContain("..").startsWith("tasks/42/");
    }

    @Test
    void nonAssigneeCannotUploadFile() throws Exception {
        authenticateAs(9L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        MockMultipartFile file = new MockMultipartFile("file", "meeting_result.pdf", "application/pdf", "hello".getBytes());

        mockMvc.perform(multipart("/api/v1/projects/demo-project/tasks/42/result/files")
                .file(file))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_ASSIGNEE"));

        verify(storageClient, never()).upload(anyString(), any(), anyLong(), any());
    }

    @Test
    void uploadFileCleansUpStorageObjectWhenMetadataSaveFails() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        when(taskResultFileRepository.save(any(TaskResultFile.class))).thenThrow(new RuntimeException("db down"));
        MockMultipartFile file = new MockMultipartFile("file", "meeting_result.pdf", "application/pdf", "hello".getBytes());

        mockMvc.perform(multipart("/api/v1/projects/demo-project/tasks/42/result/files")
                .file(file))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.error.code").value("FILE_SAVE_FAILED"));

        verify(storageClient).delete(anyString());
    }

    @Test
    void assigneeCanDeleteFile() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        TaskResultFile file = new TaskResultFile(42L, "meeting_result.pdf", "tasks/42/uuid-meeting_result.pdf", 2048, "application/pdf", 5L);
        when(taskResultFileRepository.findById(9L)).thenReturn(Optional.of(file));

        mockMvc.perform(delete("/api/v1/projects/demo-project/tasks/42/result/files/9"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(taskResultFileRepository).delete(file);
        verify(storageClient).delete("tasks/42/uuid-meeting_result.pdf");
    }

    @Test
    void deleteFileStillSucceedsWhenStorageCleanupFailsAfterMetadataDeleted() throws Exception {
        authenticateAs(5L);
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        TaskResultFile file = new TaskResultFile(42L, "meeting_result.pdf", "tasks/42/uuid-meeting_result.pdf", 2048, "application/pdf", 5L);
        when(taskResultFileRepository.findById(9L)).thenReturn(Optional.of(file));
        doThrow(new RuntimeException("storage down"))
            .when(storageClient).delete("tasks/42/uuid-meeting_result.pdf");

        mockMvc.perform(delete("/api/v1/projects/demo-project/tasks/42/result/files/9"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true));

        verify(taskResultFileRepository).delete(file);
        verify(storageClient, times(2)).delete("tasks/42/uuid-meeting_result.pdf");
    }

    @Test
    void getFileUrlRequestsSignedUrlWithOriginalFileNameForDownload() throws Exception {
        when(demoDataService.resolveProjectId("demo-project")).thenReturn(1L);
        when(taskRepository.findById(42L)).thenReturn(Optional.of(taskWithAssignee(5L)));
        TaskResultFile file = new TaskResultFile(42L, "meeting_result.pdf", "tasks/42/uuid-meeting_result.pdf", 2048, "application/pdf", 5L);
        when(taskResultFileRepository.findById(9L)).thenReturn(Optional.of(file));
        when(storageClient.createSignedUrl("tasks/42/uuid-meeting_result.pdf", 3600, "meeting_result.pdf"))
            .thenReturn("https://signed.example.com/meeting_result.pdf?download=meeting_result.pdf");

        mockMvc.perform(get("/api/v1/projects/demo-project/tasks/42/result/files/9/url"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").value("https://signed.example.com/meeting_result.pdf?download=meeting_result.pdf"));
    }
}
