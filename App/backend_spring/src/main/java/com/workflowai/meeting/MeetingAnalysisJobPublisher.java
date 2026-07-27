package com.workflowai.meeting;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

@Component
public class MeetingAnalysisJobPublisher {

    public static final String STREAM_KEY = "meeting-analysis";
    public static final int MAX_PAYLOAD_BYTES = 1024 * 1024;
    public static final int MAX_OUTSTANDING_JOBS = 1000;
    static final String QUEUE_FULL_SENTINEL = "QUEUE_FULL";

    private static final String ENQUEUE_FAILURE_MESSAGE = "Failed to enqueue meeting analysis job";
    private static final RedisScript<String> ENQUEUE_IF_CAPACITY_SCRIPT = RedisScript.of(
        new ClassPathResource("redis/meeting-analysis-enqueue.lua"),
        String.class
    );

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public MeetingAnalysisJobPublisher(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public String enqueue(Long meetingId, AiAnalyzeRequest request, Long requestedBy) {
        return enqueue(meetingId, request, UUID.randomUUID(), requestedBy);
    }

    public String enqueue(Long meetingId, AiAnalyzeRequest request, UUID jobId, Long requestedBy) {
        MeetingAnalysisJob job = new MeetingAnalysisJob(jobId.toString(), meetingId, request, requestedBy);
        String payload = serialize(job);
        if (payload.getBytes(StandardCharsets.UTF_8).length > MAX_PAYLOAD_BYTES) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE);
        }

        String recordId;
        try {
            recordId = redisTemplate.execute(
                ENQUEUE_IF_CAPACITY_SCRIPT,
                List.of(STREAM_KEY),
                Integer.toString(MAX_OUTSTANDING_JOBS),
                payload
            );
        } catch (RuntimeException exception) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE);
        }
        if (recordId == null || QUEUE_FULL_SENTINEL.equals(recordId)) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE);
        }
        return recordId;
    }

    private String serialize(MeetingAnalysisJob job) {
        try {
            return objectMapper.writeValueAsString(job);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(ENQUEUE_FAILURE_MESSAGE, exception);
        }
    }
}
