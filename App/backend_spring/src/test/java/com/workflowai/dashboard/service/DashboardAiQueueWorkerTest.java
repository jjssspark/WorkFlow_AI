package com.workflowai.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.project.ProjectRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

@ExtendWith(MockitoExtension.class)
class DashboardAiQueueWorkerTest {

    private static final String CONSUMER = "dashboard-ai-worker-test";
    private static final Long PROJECT_ID = 7L;

    @Mock private StringRedisTemplate redisTemplate;
    @Mock private StreamOperations<String, String, String> streamOperations;
    @Mock private ProjectRepository projectRepository;
    @Mock private DashboardAiJobPublisher publisher;
    @Mock private DashboardAiJobRunner runner;
    @Mock private ScheduledExecutorService pendingLeaseExecutor;
    @Mock private ScheduledFuture<?> pendingLeaseFuture;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<Long> delays = new ArrayList<>();

    @BeforeEach
    void setUp() {
        doReturn(streamOperations).when(redisTemplate).opsForStream();
    }

    @Test
    void marksDoneOnlyWhenRunnerReportsSuccess() throws Exception {
        givenSingleRecord("1-0");
        givenProjectExistsAndLeaseScheduled();
        when(runner.runJob(any(DashboardAiJob.class))).thenReturn(true);

        newWorker().pollOnce();

        verify(publisher).markDone(eq(PROJECT_ID), eq(DashboardAiJobType.DELAY_RISK), anyString());
        verify(publisher, never()).releaseInFlight(anyLong(), any(DashboardAiJobType.class), anyString());
        assertThat(delays).isEmpty();
    }

    @Test
    void releasesInFlightInsteadOfMarkingDoneWhenRunnerReportsFailure() throws Exception {
        // FastAPI 실패를 완료로 보고하면 상태 조회가 DONE을 돌려주고, 프론트가 갱신되지 않은
        // 옛 결과를 새 분석 결과로 표시한다. 완료 마커 없이 in-flight만 풀어 FAILED가 되게 한다.
        givenSingleRecord("2-0");
        givenProjectExistsAndLeaseScheduled();
        when(runner.runJob(any(DashboardAiJob.class))).thenReturn(false);

        newWorker().pollOnce();

        verify(publisher).releaseInFlight(eq(PROJECT_ID), eq(DashboardAiJobType.DELAY_RISK), anyString());
        verify(publisher, never()).markDone(anyLong(), any(DashboardAiJobType.class), anyString());
        // 레코드는 ack됐으므로 같은 작업이 큐에서 되돌아오지 않는다 - 재시도는 사용자가 다시 요청한다.
        verify(redisTemplate).execute(any(RedisScript.class), anyList(), any(Object[].class));
        assertThat(delays).isEmpty();
    }

    @Test
    void writesDoneMarkerBeforeAcknowledgingTheRecord() throws Exception {
        // 순서가 반대면, ACK/삭제 직후 마커 기록이 Redis 오류로 실패했을 때 레코드는 이미
        // 사라졌는데 완료 마커는 없어 실제로 성공한 재분석이 영구히 FAILED로 보고된다.
        givenSingleRecord("6-0");
        givenProjectExistsAndLeaseScheduled();
        when(runner.runJob(any(DashboardAiJob.class))).thenReturn(true);

        newWorker().pollOnce();

        InOrder inOrder = inOrder(publisher, redisTemplate);
        inOrder.verify(publisher).markDone(eq(PROJECT_ID), eq(DashboardAiJobType.DELAY_RISK), anyString());
        inOrder.verify(redisTemplate).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void doesNotAcknowledgeWhenTheDoneMarkerCannotBeWritten() throws Exception {
        // 마커를 못 남겼는데 레코드를 지우면 그 작업은 되살릴 방법이 없다. pending으로 남겨
        // STALE_PENDING_IDLE 뒤 회수되게 한다.
        givenSingleRecord("7-0");
        givenProjectExistsAndLeaseScheduled();
        when(runner.runJob(any(DashboardAiJob.class))).thenReturn(true);
        org.mockito.Mockito.doThrow(new DataAccessResourceFailureException("redis down"))
            .when(publisher).markDone(anyLong(), any(DashboardAiJobType.class), anyString());

        newWorker().pollOnce();

        verify(redisTemplate, never()).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void backsOffWhenProjectLookupLeavesRecordPending() throws Exception {
        // ack하지 못한 레코드는 다음 폴링의 PENDING 읽기가 논블로킹으로 즉시 다시 집어온다.
        // 백오프가 없으면 DB 장애가 이어지는 동안 스핀 루프로 CPU와 DB를 계속 때린다.
        givenSingleRecord("3-0");
        when(projectRepository.existsById(PROJECT_ID)).thenThrow(new DataAccessResourceFailureException("db down"));

        newWorker().pollOnce();

        assertThat(delays).containsExactly(250L);
        verify(publisher, never()).markDone(anyLong(), any(DashboardAiJobType.class), anyString());
        verify(redisTemplate, never()).execute(any(RedisScript.class), anyList(), any(Object[].class));
    }

    @Test
    void backsOffWhenRunnerThrows() throws Exception {
        givenSingleRecord("4-0");
        givenProjectExistsAndLeaseScheduled();
        when(runner.runJob(any(DashboardAiJob.class))).thenThrow(new IllegalStateException("boom"));

        newWorker().pollOnce();

        assertThat(delays).containsExactly(250L);
        verify(publisher, never()).markDone(anyLong(), any(DashboardAiJobType.class), anyString());
    }

    @Test
    void backoffGrowsWhileRecordStaysPending() throws Exception {
        givenSingleRecord("5-0");
        when(projectRepository.existsById(PROJECT_ID)).thenThrow(new DataAccessResourceFailureException("db down"));

        DashboardAiQueueWorker worker = newWorker();
        worker.pollOnce();
        worker.pollOnce();
        worker.pollOnce();

        assertThat(delays).containsExactly(250L, 500L, 1000L);
    }

    @Test
    void idlePollDoesNotBackOff() {
        when(streamOperations.read(any(Consumer.class), any(StreamReadOptions.class), anyStreamOffset()))
            .thenReturn(List.of());
        lenient().when(streamOperations.pending(anyString(), anyString(), any(org.springframework.data.domain.Range.class), anyLong()))
            .thenReturn(null);

        newWorker().pollOnce();

        assertThat(delays).isEmpty();
    }

    private void givenSingleRecord(String recordId) throws Exception {
        when(streamOperations.read(any(Consumer.class), any(StreamReadOptions.class), anyStreamOffset()))
            .thenReturn(List.of(record(recordId, payload())));
    }

    @SuppressWarnings("unchecked")
    private void givenProjectExistsAndLeaseScheduled() {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        doReturn(pendingLeaseFuture).when(pendingLeaseExecutor)
            .scheduleWithFixedDelay(any(Runnable.class), anyLong(), anyLong(), any());
    }

    private DashboardAiQueueWorker newWorker() {
        return new DashboardAiQueueWorker(
            redisTemplate, objectMapper, projectRepository, publisher, runner,
            delays::add, CONSUMER, pendingLeaseExecutor
        );
    }

    private String payload() throws Exception {
        return objectMapper.writeValueAsString(new DashboardAiJob(
            UUID.nameUUIDFromBytes("job".getBytes()).toString(), PROJECT_ID, DashboardAiJobType.DELAY_RISK, 5L
        ));
    }

    private MapRecord<String, String, String> record(String id, String payload) {
        return MapRecord.create(DashboardAiJobPublisher.STREAM_KEY, Map.of("payload", payload))
            .withId(RecordId.of(id));
    }

    @SuppressWarnings("unchecked")
    private StreamOffset<String>[] anyStreamOffset() {
        return any(StreamOffset[].class);
    }
}
