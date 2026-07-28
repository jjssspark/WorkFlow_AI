package com.workflowai.roadmap;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(RoadmapController.class)
@AutoConfigureMockMvc(addFilters = false)
class RoadmapControllerNotFoundTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private RoadmapService roadmapService;

    @Test
    void getRoadmapReturnsNotFoundEnvelopeWhenProjectIsMissing() throws Exception {
        when(roadmapService.getRoadmap("missing-project"))
            .thenThrow(new RoadmapException(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다."));

        mockMvc.perform(get("/api/v1/projects/missing-project/roadmap"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.data").doesNotExist())
            .andExpect(jsonPath("$.error.code").value("PROJECT_NOT_FOUND"))
            .andExpect(jsonPath("$.error.message").isNotEmpty());
    }
}
