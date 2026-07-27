package com.workflowai.evaluation;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.common.GlobalExceptionHandler;
import java.math.BigDecimal;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class EvaluationSettingControllerTest {

    @Mock
    private EvaluationSettingRepository evaluationSettingRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private MockMvc mockMvc() {
        return MockMvcBuilders.standaloneSetup(new EvaluationSettingController(evaluationSettingRepository))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    void getReturnsDefaultRatioWhenNoSettingSaved() throws Exception {
        when(evaluationSettingRepository.findById(1L)).thenReturn(Optional.empty());

        mockMvc().perform(get("/api/v1/projects/1/evaluation-settings"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.contributionRatio").value(40.00));
    }

    @Test
    void getReturnsSavedRatio() throws Exception {
        when(evaluationSettingRepository.findById(1L))
            .thenReturn(Optional.of(new EvaluationSetting(1L, new BigDecimal("55.00"))));

        mockMvc().perform(get("/api/v1/projects/1/evaluation-settings"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.contributionRatio").value(55.00));
    }

    @Test
    void upsertSavesNewRatio() throws Exception {
        when(evaluationSettingRepository.findById(1L)).thenReturn(Optional.empty());
        when(evaluationSettingRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        mockMvc().perform(put("/api/v1/projects/1/evaluation-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new EvaluationSettingRequest(new BigDecimal("70.00")))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.contributionRatio").value(70.00));
    }

    @Test
    void upsertReturns400WhenContributionRatioOutOfRange() throws Exception {
        mockMvc().perform(put("/api/v1/projects/1/evaluation-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new EvaluationSettingRequest(new BigDecimal("150.00")))))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }

    @Test
    void upsertReturns400WhenContributionRatioMissing() throws Exception {
        mockMvc().perform(put("/api/v1/projects/1/evaluation-settings")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new EvaluationSettingRequest(null))))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));
    }
}
