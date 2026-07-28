package com.workflowai.comment;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.common.DemoDataService;
import com.workflowai.notification.NotificationService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.security.ProjectAccess;
import com.workflowai.security.UserPrincipal;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import testsupport.AccessDeniedEnvelopeAdvice;

@WebMvcTest(PersonalCommentController.class)
@AutoConfigureMockMvc(addFilters = false)
@ContextConfiguration(classes = PersonalCommentControllerTest.MethodSecurityTestConfig.class)
class PersonalCommentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PersonalCommentRepository personalCommentRepository;

    @MockitoBean
    private ProjectMemberRepository projectMemberRepository;

    @MockitoBean
    private UserRepository userRepository;

    @MockitoBean
    private NotificationService notificationService;

    @MockitoBean
    private DemoDataService demoDataService;

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

    private PersonalComment commentWithId(Long id, Long projectId, Long targetUserId, Long authorId, String content, Long parentId) {
        PersonalComment comment = new PersonalComment(projectId, "personal", targetUserId, authorId, content, parentId);
        ReflectionTestUtils.setField(comment, "id", id);
        return comment;
    }

    @Test
    void reviewerCanCreateCommentAndNotifiesTarget() throws Exception {
        authenticateAs(20L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 20L))
            .thenReturn(Optional.of(new ProjectMember(1L, 20L, ProjectRole.REVIEWER)));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 10L)).thenReturn(true);
        when(personalCommentRepository.findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(1L, 10L))
            .thenReturn(List.of());
        when(personalCommentRepository.save(any(PersonalComment.class)))
            .thenAnswer(inv -> {
                PersonalComment saved = inv.getArgument(0);
                ReflectionTestUtils.setField(saved, "id", 100L);
                return saved;
            });
        when(userRepository.findById(20L)).thenReturn(Optional.of(new User("reviewer@workflow.ai", "심사자", "demo", "9")));

        mockMvc.perform(post("/api/v1/projects/1/members/10/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"UI가 깔끔하네요"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.authorName").value("심사자"))
            .andExpect(jsonPath("$.data.parentId").doesNotExist());

        verify(notificationService).notifyAfterCommit(
            eq(10L), eq(1L), eq("PERSONAL_COMMENT"), any(), any(), eq("personal_comment"), eq(100L)
        );
    }

    @Test
    void nonReviewerCannotCreateComment() throws Exception {
        authenticateAs(30L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 30L))
            .thenReturn(Optional.of(new ProjectMember(1L, 30L, ProjectRole.MEMBER)));

        mockMvc.perform(post("/api/v1/projects/1/members/10/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"저도 코멘트 남길게요"}
                    """))
            .andExpect(status().isForbidden());

        verify(notificationService, never()).notifyAfterCommit(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void creatingCommentForNonProjectMemberFails() throws Exception {
        authenticateAs(20L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 20L))
            .thenReturn(Optional.of(new ProjectMember(1L, 20L, ProjectRole.REVIEWER)));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 999L)).thenReturn(false);

        mockMvc.perform(post("/api/v1/projects/1/members/999/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"코멘트"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("USER_NOT_PROJECT_MEMBER"));
    }

    @Test
    void targetUserCanReplyAndNotifiesOriginalAuthor() throws Exception {
        authenticateAs(10L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 10L))
            .thenReturn(Optional.of(new ProjectMember(1L, 10L, ProjectRole.MEMBER)));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 10L)).thenReturn(true);
        PersonalComment parent = commentWithId(100L, 1L, 10L, 20L, "UI가 깔끔하네요", null);
        when(personalCommentRepository.findById(100L)).thenReturn(Optional.of(parent));
        when(personalCommentRepository.findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(1L, 10L))
            .thenReturn(List.of(parent));
        when(personalCommentRepository.save(any(PersonalComment.class)))
            .thenAnswer(inv -> {
                PersonalComment saved = inv.getArgument(0);
                ReflectionTestUtils.setField(saved, "id", 101L);
                return saved;
            });
        when(userRepository.findById(10L)).thenReturn(Optional.of(new User("member@workflow.ai", "이서연", "demo", "2")));

        mockMvc.perform(post("/api/v1/projects/1/comments/100/replies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"감사합니다!"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.parentId").value(100));

        verify(notificationService).notifyAfterCommit(
            eq(20L), eq(1L), eq("PERSONAL_COMMENT_REPLY"), any(), any(), eq("personal_comment"), eq(100L)
        );
    }

    @Test
    void nonTargetUserCannotReply() throws Exception {
        authenticateAs(999L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 999L))
            .thenReturn(Optional.of(new ProjectMember(1L, 999L, ProjectRole.MEMBER)));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 999L)).thenReturn(true);
        PersonalComment parent = commentWithId(100L, 1L, 10L, 20L, "UI가 깔끔하네요", null);
        when(personalCommentRepository.findById(100L)).thenReturn(Optional.of(parent));

        mockMvc.perform(post("/api/v1/projects/1/comments/100/replies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"제가 답글 달아볼게요"}
                    """))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error.code").value("FORBIDDEN_NOT_TARGET_USER"));
    }

    @Test
    void cannotReplyToAReply() throws Exception {
        authenticateAs(10L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 10L))
            .thenReturn(Optional.of(new ProjectMember(1L, 10L, ProjectRole.MEMBER)));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 10L)).thenReturn(true);
        PersonalComment reply = commentWithId(101L, 1L, 10L, 10L, "감사합니다!", 100L);
        when(personalCommentRepository.findById(101L)).thenReturn(Optional.of(reply));

        mockMvc.perform(post("/api/v1/projects/1/comments/101/replies")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"답글에 또 답글"}
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("REPLY_TO_REPLY_NOT_ALLOWED"));
    }

    @Test
    void enforceLimitDeletesOldestAndOrphanedRepliesOfDeletedParents() throws Exception {
        authenticateAs(20L);
        when(projectMemberRepository.findByProjectIdAndUserId(1L, 20L))
            .thenReturn(Optional.of(new ProjectMember(1L, 20L, ProjectRole.REVIEWER)));
        when(projectMemberRepository.existsByProjectIdAndUserId(1L, 10L)).thenReturn(true);
        when(userRepository.findById(20L)).thenReturn(Optional.of(new User("reviewer@workflow.ai", "심사자", "demo", "9")));
        when(personalCommentRepository.save(any(PersonalComment.class)))
            .thenAnswer(inv -> {
                PersonalComment saved = inv.getArgument(0);
                ReflectionTestUtils.setField(saved, "id", 11L);
                return saved;
            });

        // 저장 직후 조회되는 목록 — 방금 저장된 11번째(id=11) 포함, 총 11건.
        // id=1이 가장 오래된 원 코멘트, id=2는 그 답글(더 최신이라 "유지" 구간에 있음).
        List<PersonalComment> elevenItemsAfterInsert = new ArrayList<>();
        elevenItemsAfterInsert.add(commentWithId(1L, 1L, 10L, 20L, "가장 오래된 원 코멘트", null));
        elevenItemsAfterInsert.add(commentWithId(2L, 1L, 10L, 10L, "가장 오래된 코멘트의 답글", 1L));
        for (long i = 3; i <= 11; i++) {
            elevenItemsAfterInsert.add(commentWithId(i, 1L, 10L, 20L, "코멘트" + i, null));
        }
        when(personalCommentRepository.findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(1L, 10L))
            .thenReturn(elevenItemsAfterInsert);

        mockMvc.perform(post("/api/v1/projects/1/members/10/comments")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"content":"11번째 코멘트"}
                    """))
            .andExpect(status().isOk());

        verify(personalCommentRepository).deleteAllByIdInBatch(argThat(ids -> {
            Set<Long> idSet = new HashSet<>();
            for (Long id : (Iterable<Long>) ids) {
                idSet.add(id);
            }
            return idSet.equals(Set.of(1L, 2L));
        }));
    }

    @Configuration
    @EnableMethodSecurity
    @Import(PersonalCommentController.class)
    static class MethodSecurityTestConfig {
        @Bean
        AccessDeniedEnvelopeAdvice accessDeniedEnvelopeAdvice() {
            return new AccessDeniedEnvelopeAdvice();
        }

        @Bean("projectAccess")
        ProjectAccess projectAccess(ProjectMemberRepository projectMemberRepository, DemoDataService demoDataService) {
            return new ProjectAccess(projectMemberRepository, demoDataService);
        }
    }
}
