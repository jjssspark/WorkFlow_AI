package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

@ExtendWith(MockitoExtension.class)
class MeetingAnalysisJobPublisherTest {

    private static final String RAW_TEXT = "외부에 노출되면 안 되는 회의 원문";

    @Mock private StringRedisTemplate redisTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final AiAnalyzeRequest request = new AiAnalyzeRequest(
        "project-1",
        "분기 계획 회의",
        "2026-07-23",
        "planning",
        "document",
        "meeting.txt",
        RAW_TEXT,
        List.of("김민준", "이서연")
    );

    @Test
    void enqueuesSerializedJobAndReturnsRedisRecordId() throws Exception {
        String recordId = "1753257600000-0";
        when(redisTemplate.execute(any(RedisScript.class), anyList(), any(Object[].class)))
            .thenReturn(recordId);
        MeetingAnalysisJobPublisher publisher = new MeetingAnalysisJobPublisher(redisTemplate, objectMapper);
        UUID jobId = UUID.randomUUID();

        String result = publisher.enqueue(42L, request, jobId, 77L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<RedisScript<String>> scriptCaptor = ArgumentCaptor.forClass(RedisScript.class);
        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(redisTemplate).execute(
            scriptCaptor.capture(),
            eq(List.of(MeetingAnalysisJobPublisher.STREAM_KEY)),
            eq(Integer.toString(MeetingAnalysisJobPublisher.MAX_OUTSTANDING_JOBS)),
            payloadCaptor.capture()
        );
        MeetingAnalysisJob job = objectMapper.readValue((String) payloadCaptor.getValue(), MeetingAnalysisJob.class);
        assertThat(job.jobId()).isEqualTo(jobId.toString());
        assertThat(job.meetingId()).isEqualTo(42L);
        assertThat(job.request()).isEqualTo(request);
        assertThat(job.requestedBy()).isEqualTo(77L);
        assertThat(result).isEqualTo(recordId);

        String script = scriptCaptor.getValue().getScriptAsString();
        ClassPathResource scriptResource = new ClassPathResource("redis/meeting-analysis-enqueue.lua");
        assertThat(scriptResource.exists()).isTrue();
        String resourceScript = new String(scriptResource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertThat(script).isEqualTo(resourceScript);
        assertThat(script.indexOf("acl_check_cmd('XLEN'")).isGreaterThanOrEqualTo(0);
        assertThat(script.indexOf("acl_check_cmd('XADD'")).isGreaterThan(script.indexOf("acl_check_cmd('XLEN'"));
        assertThat(script.indexOf("redis.call('XLEN'")).isGreaterThan(script.indexOf("acl_check_cmd('XADD'"));
        assertThat(script.indexOf("redis.call('XADD'")).isGreaterThan(script.indexOf("redis.call('XLEN'"));
    }

    @Test
    void throwsIllegalStateExceptionWhenSerializationFails() throws Exception {
        ObjectMapper failingObjectMapper = org.mockito.Mockito.mock(ObjectMapper.class);
        JsonProcessingException failure = new JsonProcessingException("serialization failed") {};
        when(failingObjectMapper.writeValueAsString(any(MeetingAnalysisJob.class))).thenThrow(failure);
        MeetingAnalysisJobPublisher publisher = new MeetingAnalysisJobPublisher(redisTemplate, failingObjectMapper);

        assertThatThrownBy(() -> publisher.enqueue(42L, request, 77L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Failed to enqueue meeting analysis job")
            .hasCause(failure)
            .hasMessageNotContaining(RAW_TEXT);
        verify(redisTemplate, never()).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void throwsSafeIllegalStateExceptionWhenAtomicRedisScriptFails() {
        RuntimeException failure = new RuntimeException("redis://admin:secret@internal:6379");
        when(redisTemplate.execute(any(RedisScript.class), anyList(), any(Object[].class)))
            .thenThrow(failure);
        MeetingAnalysisJobPublisher publisher = new MeetingAnalysisJobPublisher(redisTemplate, objectMapper);

        assertThatThrownBy(() -> publisher.enqueue(42L, request, 77L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Failed to enqueue meeting analysis job")
            .hasNoCause()
            .hasMessageNotContaining("admin:secret")
            .hasMessageNotContaining(RAW_TEXT);
    }

    @Test
    void rejectsOversizedUtf8PayloadWithoutAddingToRedis() {
        AiAnalyzeRequest oversizedRequest = new AiAnalyzeRequest(
            "project-1",
            "대용량 회의",
            "2026-07-23",
            "planning",
            "document",
            "meeting.txt",
            "가".repeat(MeetingAnalysisJobPublisher.MAX_PAYLOAD_BYTES),
            List.of("김민준")
        );
        MeetingAnalysisJobPublisher publisher = new MeetingAnalysisJobPublisher(redisTemplate, objectMapper);

        assertThatThrownBy(() -> publisher.enqueue(42L, oversizedRequest, 77L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Failed to enqueue meeting analysis job")
            .hasMessageNotContaining("가");
        verify(redisTemplate, never()).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void rejectsJobWhenAtomicScriptReturnsQueueFullSentinel() {
        when(redisTemplate.execute(any(RedisScript.class), anyList(), any(Object[].class)))
            .thenReturn(MeetingAnalysisJobPublisher.QUEUE_FULL_SENTINEL);
        MeetingAnalysisJobPublisher publisher = new MeetingAnalysisJobPublisher(redisTemplate, objectMapper);

        assertThatThrownBy(() -> publisher.enqueue(42L, request, 77L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Failed to enqueue meeting analysis job")
            .hasNoCause()
            .hasMessageNotContaining(RAW_TEXT);
    }

    @Test
    void rejectsJobWhenAtomicScriptReturnsNull() {
        when(redisTemplate.execute(any(RedisScript.class), anyList(), any(Object[].class)))
            .thenReturn(null);
        MeetingAnalysisJobPublisher publisher = new MeetingAnalysisJobPublisher(redisTemplate, objectMapper);

        assertThatThrownBy(() -> publisher.enqueue(42L, request, 77L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("Failed to enqueue meeting analysis job")
            .hasNoCause()
            .hasMessageNotContaining(RAW_TEXT);
    }
}
