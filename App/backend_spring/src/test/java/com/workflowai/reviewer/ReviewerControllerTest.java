package com.workflowai.reviewer;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.security.UserPrincipal;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class ReviewerControllerTest {

    private static final Long CURRENT_USER_ID = 9L;

    @Mock
    private ReviewerService reviewerService;

    @BeforeEach
    void authenticateAsCurrentUser() {
        UserPrincipal principal = new UserPrincipal(CURRENT_USER_ID, "reviewer@example.com", "박현수");
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, List.of())
        );
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void myReviewProjectsReturnsDataFromService() throws Exception {
        ReviewerProjectSummary summary = new ReviewerProjectSummary(
            3L, "실시간 버스 도착 알리미", "캡스톤디자인", "이준혁", 5, 88, "published", 5, 5, true
        );
        when(reviewerService.getMyReviewProjects(eq(CURRENT_USER_ID))).thenReturn(List.of(summary));

        ReviewerController controller = new ReviewerController(reviewerService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/me/reviewer-projects"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data[0].projectId").value(3))
            .andExpect(jsonPath("$.data[0].title").value("실시간 버스 도착 알리미"))
            .andExpect(jsonPath("$.data[0].evalStatus").value("published"));
    }

    @Test
    void myReviewProjectsReturnsEmptyArrayWhenCallerReviewsNothing() throws Exception {
        when(reviewerService.getMyReviewProjects(eq(CURRENT_USER_ID))).thenReturn(List.of());

        ReviewerController controller = new ReviewerController(reviewerService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/me/reviewer-projects"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isArray())
            .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void myRecentActivitiesReturnsDataFromService() throws Exception {
        ReviewerActivityDto activity = new ReviewerActivityDto(
            "100", "실시간 버스 도착 알리미", "김민준님의 학점을 공개했습니다.", "2026-07-28T01:00:00Z"
        );
        when(reviewerService.getMyRecentActivities(eq(CURRENT_USER_ID))).thenReturn(List.of(activity));

        ReviewerController controller = new ReviewerController(reviewerService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/me/reviewer-activities"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data[0].id").value("100"))
            .andExpect(jsonPath("$.data[0].projectTitle").value("실시간 버스 도착 알리미"))
            .andExpect(jsonPath("$.data[0].message").value("김민준님의 학점을 공개했습니다."));
    }

    @Test
    void myRecentActivitiesReturnsEmptyArrayWhenCallerHasNoActivities() throws Exception {
        when(reviewerService.getMyRecentActivities(eq(CURRENT_USER_ID))).thenReturn(List.of());

        ReviewerController controller = new ReviewerController(reviewerService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/me/reviewer-activities"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isArray())
            .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void myLastAccessReturnsDataFromService() throws Exception {
        ProjectLastAccessDto lastAccess = new ProjectLastAccessDto(3L, "2026-07-28T01:00:00.000Z");
        when(reviewerService.getMyLastAccess(eq(CURRENT_USER_ID))).thenReturn(List.of(lastAccess));

        ReviewerController controller = new ReviewerController(reviewerService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/me/reviewer-last-access"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data[0].projectId").value(3))
            .andExpect(jsonPath("$.data[0].lastAccessedAt").value("2026-07-28T01:00:00.000Z"));
    }

    @Test
    void myLastAccessReturnsEmptyArrayWhenCallerHasNoAccessRecorded() throws Exception {
        when(reviewerService.getMyLastAccess(eq(CURRENT_USER_ID))).thenReturn(List.of());

        ReviewerController controller = new ReviewerController(reviewerService);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(controller).build();

        mockMvc.perform(get("/api/v1/me/reviewer-last-access"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isArray())
            .andExpect(jsonPath("$.data.length()").value(0));
    }
}
