package com.workflowai.common;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.meeting.MeetingAnalysisQueueWorker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

class CorsConfigTest {

    private static final String ALLOWED_ORIGIN = "http://localhost:5173";

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        CorsConfigurationSource corsConfigurationSource = new CorsConfig()
            .corsConfigurationSource(ALLOWED_ORIGIN + ",http://127.0.0.1:5173");

        HealthController healthController = new HealthController(
            mock(RedisConnectionFactory.class),
            mock(MeetingAnalysisQueueWorker.class),
            mock(JdbcTemplate.class)
        );

        mockMvc = MockMvcBuilders.standaloneSetup(healthController)
            .addFilter(new CorsFilter(corsConfigurationSource))
            .build();
    }

    @Test
    void respondsToPreflightFromAllowedOriginWithAllowedHeadersAndMethods() throws Exception {
        mockMvc.perform(options("/api/v1/health")
                .header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN)
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type"))
            .andExpect(status().isOk())
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN))
            .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, containsString("GET")))
            .andExpect(header().exists(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS));
    }

    @Test
    void rejectsPreflightFromDisallowedOriginWithoutGrantingAllowOriginHeader() throws Exception {
        mockMvc.perform(options("/api/v1/health")
                .header(HttpHeaders.ORIGIN, "https://evil.example")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
            .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }
}
