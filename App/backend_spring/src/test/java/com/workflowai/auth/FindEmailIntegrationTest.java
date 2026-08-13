package com.workflowai.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workflowai.support.PostgresRedisIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

class FindEmailIntegrationTest extends PostgresRedisIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void seed() {
        jdbcTemplate.update("DELETE FROM users WHERE email = ?", "findme@example.com");
        jdbcTemplate.update(
            "INSERT INTO users (email, name, provider, provider_id, password_hash, affiliation, is_admin, "
                + "field_tags, created_at, updated_at) "
                + "VALUES (?, ?, 'local', ?, 'hash', ?, false, '[]', NOW(), NOW())",
            "findme@example.com", "김찾기", "findme@example.com", "컴퓨터공학과"
        );
    }

    @Test
    @DisplayName("이름과 소속이 맞으면 마스킹된 이메일을 돌려준다")
    void findEmail_match() throws Exception {
        mockMvc.perform(post("/api/v1/auth/find-email")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"김찾기\",\"affiliation\":\"컴퓨터공학과\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.maskedEmails[0]").value("fi****@example.com"));
    }

    @Test
    @DisplayName("일치하는 계정이 없어도 200과 빈 목록")
    void findEmail_noMatch_stillOk() throws Exception {
        mockMvc.perform(post("/api/v1/auth/find-email")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"없는사람\",\"affiliation\":\"없는소속\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.maskedEmails").isEmpty());
    }

    @Test
    @DisplayName("이름이 비면 400")
    void findEmail_blankName_rejected() throws Exception {
        mockMvc.perform(post("/api/v1/auth/find-email")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"\",\"affiliation\":\"컴퓨터공학과\"}"))
            .andExpect(status().isBadRequest());
    }
}
