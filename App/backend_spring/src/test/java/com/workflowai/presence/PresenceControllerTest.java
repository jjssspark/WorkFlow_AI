package com.workflowai.presence;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.task.S3StorageClient;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(PresenceController.class)
@AutoConfigureMockMvc(addFilters = false)
class PresenceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @MockitoBean
    private UserRepository userRepository;

    @MockitoBean
    private DemoDataService demoDataService;

    @MockitoBean
    private PresenceService presenceService;

    @MockitoBean
    private S3StorageClient storageClient;

    private User userWith(long id, String name, String profileImagePath) {
        User user = new User("user" + id + "@workflow.ai", name, "local", "user" + id + "@workflow.ai", "hash");
        ReflectionTestUtils.setField(user, "id", id);
        user.setProfileImagePath(profileImagePath);
        return user;
    }

    /** 접속자 1명이 활성 상태인 상황을 만든다. */
    private void givenActiveMember(User user) {
        when(demoDataService.resolveProjectId("1")).thenReturn(1L);
        when(projectMemberRepository.findAllByProjectId(1L))
            .thenReturn(List.of(new ProjectMember(1L, user.getId(), ProjectRole.LEADER)));
        when(presenceService.activeUserIds(List.of(user.getId()))).thenReturn(List.of(user.getId()));
        when(userRepository.findAllById(List.of(user.getId()))).thenReturn(List.of(user));
    }

    @Test
    void 프로필_사진이_있으면_서명_URL을_함께_내려준다() throws Exception {
        givenActiveMember(userWith(1L, "허영주", "avatars/1/a.png"));
        when(storageClient.createSignedUrl(anyString(), anyInt(), any()))
            .thenReturn("https://storage.example/avatars/1/a.png?sig=x");

        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].name").value("허영주"))
            .andExpect(jsonPath("$.data[0].avatarUrl").value("https://storage.example/avatars/1/a.png?sig=x"));
    }

    @Test
    void 프로필_사진이_없으면_avatarUrl은_비어있다() throws Exception {
        givenActiveMember(userWith(2L, "박지수", null));

        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].name").value("박지수"))
            .andExpect(jsonPath("$.data[0].avatarUrl").doesNotExist());
    }

    @Test
    void 서명_URL_발급이_실패해도_접속자_목록은_그대로_내려준다() throws Exception {
        givenActiveMember(userWith(3L, "고무서", "avatars/3/a.png"));
        when(storageClient.createSignedUrl(anyString(), anyInt(), any()))
            .thenThrow(new RuntimeException("storage down"));

        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data[0].name").value("고무서"))
            .andExpect(jsonPath("$.data[0].avatarUrl").doesNotExist());
    }

    /**
     * 프론트가 5초마다 폴링하므로, 매 요청마다 새 서명 URL을 만들면 {@code <img src>}가 계속 바뀌어
     * 브라우저가 같은 사진을 반복해서 내려받는다. 같은 경로면 같은 URL이 나와야 한다.
     */
    @Test
    void 같은_경로에_대한_서명_URL은_폴링마다_다시_만들지_않는다() throws Exception {
        givenActiveMember(userWith(4L, "유소은", "avatars/4/a.png"));
        when(storageClient.createSignedUrl(anyString(), anyInt(), any()))
            .thenReturn("https://storage.example/avatars/4/a.png?sig=first");

        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(jsonPath("$.data[0].avatarUrl").value("https://storage.example/avatars/4/a.png?sig=first"));
        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(jsonPath("$.data[0].avatarUrl").value("https://storage.example/avatars/4/a.png?sig=first"));

        verify(storageClient, times(1)).createSignedUrl(anyString(), anyInt(), any());
    }

    /** 사진을 바꾸면 저장 경로(UUID)가 바뀌므로, 캐시에 막히지 않고 새 URL이 바로 반영돼야 한다. */
    @Test
    void 프로필_사진을_바꾸면_새_URL이_바로_반영된다() throws Exception {
        givenActiveMember(userWith(5L, "이은주", "avatars/5/old.png"));
        when(storageClient.createSignedUrl(anyString(), anyInt(), any()))
            .thenReturn("https://storage.example/avatars/5/old.png?sig=x");

        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(jsonPath("$.data[0].avatarUrl").value("https://storage.example/avatars/5/old.png?sig=x"));

        givenActiveMember(userWith(5L, "이은주", "avatars/5/new.png"));
        when(storageClient.createSignedUrl(anyString(), anyInt(), any()))
            .thenReturn("https://storage.example/avatars/5/new.png?sig=y");

        mockMvc.perform(get("/api/v1/projects/1/presence"))
            .andExpect(jsonPath("$.data[0].avatarUrl").value("https://storage.example/avatars/5/new.png?sig=y"));
    }
}
