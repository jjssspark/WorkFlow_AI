package com.workflowai.auth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.security.UserPrincipal;
import com.workflowai.task.SupabaseStorageClient;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(MeController.class)
@AutoConfigureMockMvc(addFilters = false)
class MeControllerTest {

    // ImageIO.write()로 직접 생성한, 끝까지 온전히 디코딩되는 진짜 1x1 PNG(픽셀 데이터 포함).
    private static final byte[] VALID_PNG = Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4XmP4z8AAAAMBAQAwOwdeAAAAAElFTkSuQmCC"
    );
    // 시그니처(signature)+IHDR 청크만 남기고 IDAT/IEND를 잘라낸, 헤더는 진짜지만 픽셀 데이터가 없는 PNG.
    // 헤더만으로 하는 해상도 사전검사는 통과하지만, 전체 디코딩(ImageIO.read)에서는 실패해야 한다.
    private static final byte[] TRUNCATED_PNG_HEADER_ONLY = java.util.Arrays.copyOfRange(VALID_PNG, 0, 33);

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private UserRepository userRepository;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @MockitoBean
    private ProjectRepository projectRepository;

    @MockitoBean
    private SupabaseStorageClient storageClient;

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(long userId) {
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(
                new UserPrincipal(userId, "user" + userId + "@workflow.ai", "테스트유저"), null, List.of()
            )
        );
    }

    private User userWithId(long id) {
        User user = new User("user" + id + "@workflow.ai", "테스트유저", "local", "user" + id + "@workflow.ai", "hash");
        ReflectionTestUtils.setField(user, "id", id);
        return user;
    }

    // ─── 프로필 수정: 분야 태그 필터링/경계값 ──────────────────────────────────

    @Test
    void updateProfileFiltersNullBlankAndDuplicateFieldTags() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"홍길동","affiliation":null,"field":["백엔드","  백엔드  ","","  ",null,"AI"],"githubUsername":null}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.field.length()").value(2))
            .andExpect(jsonPath("$.data.field[0]").value("백엔드"))
            .andExpect(jsonPath("$.data.field[1]").value("AI"));
    }

    @Test
    void updateProfileAcceptsExactlyMaxFieldTags() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        String tenTags = "\"t1\",\"t2\",\"t3\",\"t4\",\"t5\",\"t6\",\"t7\",\"t8\",\"t9\",\"t10\"";

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"홍길동\",\"field\":[" + tenTags + "]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.field.length()").value(10));
    }

    @Test
    void updateProfileRejectsMoreThanMaxFieldTags() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        String elevenTags = "\"t1\",\"t2\",\"t3\",\"t4\",\"t5\",\"t6\",\"t7\",\"t8\",\"t9\",\"t10\",\"t11\"";

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"홍길동\",\"field\":[" + elevenTags + "]}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("TOO_MANY_FIELD_TAGS"));

        verify(userRepository, never()).save(any());
    }

    @Test
    void updateProfileAcceptsFieldTagAtMaxLength() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        String thirtyChars = "a".repeat(30);

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"홍길동\",\"field\":[\"" + thirtyChars + "\"]}"))
            .andExpect(status().isOk());
    }

    @Test
    void updateProfileRejectsFieldTagOverMaxLength() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        String thirtyOneChars = "a".repeat(31);

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"홍길동\",\"field\":[\"" + thirtyOneChars + "\"]}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("FIELD_TAG_TOO_LONG"));

        verify(userRepository, never()).save(any());
    }

    // ─── 프로필 수정: GitHub 아이디 경계값 ──────────────────────────────────

    @Test
    void updateProfileAcceptsValidGithubUsername() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"홍길동","githubUsername":"octo-cat123"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.githubUsername").value("octo-cat123"));
    }

    @Test
    void updateProfileRejectsGithubUsernameStartingWithHyphen() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"홍길동","githubUsername":"-badname"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("GITHUB_USERNAME_INVALID"));

        verify(userRepository, never()).save(any());
    }

    @Test
    void updateProfileRejectsGithubUsernameWithConsecutiveHyphens() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"name":"홍길동","githubUsername":"bad--name"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("GITHUB_USERNAME_INVALID"));
    }

    @Test
    void updateProfileRejectsGithubUsernameOverMaxLength() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        String fortyChars = "a".repeat(40);

        mockMvc.perform(put("/api/v1/me/profile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"홍길동\",\"githubUsername\":\"" + fortyChars + "\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("GITHUB_USERNAME_INVALID"));
    }

    // ─── 아바타 업로드: 위장 파일/매직 바이트 ──────────────────────────────────

    @Test
    void uploadAvatarRejectsFileWithFakeImageContent() throws Exception {
        authenticateAs(1L);
        MockMultipartFile fakeImage = new MockMultipartFile(
            "file", "avatar.png", "image/png", "이건 이미지가 아니라 그냥 텍스트입니다".getBytes()
        );

        mockMvc.perform(multipart("/api/v1/me/avatar").file(fakeImage))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("UNSUPPORTED_FILE_TYPE"));

        verify(storageClient, never()).upload(anyString(), any(), anyLong(), any());
    }

    @Test
    void uploadAvatarIgnoresClientDeclaredContentTypeAndUsesMagicBytes() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        // 클라이언트는 image/jpeg라고 선언하지만 실제 바이트는 PNG다 — 서버는 매직 바이트로만 판정해야 한다.
        MockMultipartFile mislabeled = new MockMultipartFile("file", "avatar.jpg", "image/jpeg", VALID_PNG);

        mockMvc.perform(multipart("/api/v1/me/avatar").file(mislabeled))
            .andExpect(status().isOk());

        verify(storageClient).upload(anyString(), any(), anyLong(), eq("image/png"));
    }

    @Test
    void uploadAvatarRejectsCorruptedImageWithValidHeaderButNoPixelData() throws Exception {
        authenticateAs(1L);
        MockMultipartFile truncated = new MockMultipartFile("file", "avatar.png", "image/png", TRUNCATED_PNG_HEADER_ONLY);

        mockMvc.perform(multipart("/api/v1/me/avatar").file(truncated))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_IMAGE"));

        verify(storageClient, never()).upload(anyString(), any(), anyLong(), any());
    }

    @Test
    void uploadAvatarSucceedsAndReturnsSignedUrl() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(storageClient.createSignedUrl(anyString(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.isNull()))
            .thenReturn("https://signed.example/avatar.png");
        MockMultipartFile file = new MockMultipartFile("file", "avatar.png", "image/png", VALID_PNG);

        mockMvc.perform(multipart("/api/v1/me/avatar").file(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.avatarUrl").value("https://signed.example/avatar.png"));

        verify(storageClient).upload(anyString(), any(), anyLong(), eq("image/png"));
    }

    // ─── 아바타 업로드: DB 저장 실패 시 스토리지 롤백 ──────────────────────────

    @Test
    void uploadAvatarCleansUpStorageObjectWhenProfileSaveFails() throws Exception {
        authenticateAs(1L);
        when(userRepository.findById(1L)).thenReturn(Optional.of(userWithId(1L)));
        when(userRepository.save(any(User.class))).thenThrow(new RuntimeException("db down"));
        MockMultipartFile file = new MockMultipartFile("file", "avatar.png", "image/png", VALID_PNG);

        mockMvc.perform(multipart("/api/v1/me/avatar").file(file))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.error.code").value("PROFILE_SAVE_FAILED"));

        verify(storageClient).upload(anyString(), any(), anyLong(), eq("image/png"));
        verify(storageClient).delete(anyString());
    }

    @Test
    void uploadAvatarRejectsFileOverMaxSize() throws Exception {
        authenticateAs(1L);
        byte[] oversized = new byte[11 * 1024 * 1024];
        MockMultipartFile file = new MockMultipartFile("file", "avatar.png", "image/png", oversized);

        mockMvc.perform(multipart("/api/v1/me/avatar").file(file))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("FILE_TOO_LARGE"));

        verify(storageClient, never()).upload(anyString(), any(), anyLong(), any());
    }
}
