package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class MeetingAnalysisRunnerTest {

    @Mock private FastApiMeetingClient fastApiMeetingClient;
    @Mock private FallbackMeetingAnalyzer fallbackMeetingAnalyzer;
    @Mock private MeetingAnalysisPersistence meetingAnalysisPersistence;
    @Mock private MeetingRepository meetingRepository;

    private final AiAnalyzeRequest request = new AiAnalyzeRequest(
        "demo-project", "정기회의", "2026-07-15", "정기회의", "document", "a.txt", "내용", List.of("김민준")
    );
    private final UUID jobId = UUID.randomUUID();
    private final Long requestedBy = 77L;

    private MeetingAnalysisRunner newRunner() {
        when(meetingAnalysisPersistence.claimJob(9L, jobId)).thenReturn(true);
        return new MeetingAnalysisRunner(fastApiMeetingClient, fallbackMeetingAnalyzer, meetingAnalysisPersistence, meetingRepository);
    }

    @Test
    void savesSuccessWithFastApiSourceWhenFastApiSucceeds() {
        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(), new MeetingMeta("정기회의", "2026-07-15", List.of())
        );
        when(fastApiMeetingClient.analyze(request)).thenReturn(result);

        newRunner().runAnalysis(9L, request, jobId, requestedBy);

        verify(meetingAnalysisPersistence).saveAnalysisSuccessForJob(9L, result, "FASTAPI", jobId, requestedBy);
        verify(meetingAnalysisPersistence, never()).saveAnalysisFailureForJob(any(), any(), any());
    }

    @Test
    void fallsBackToSpringAnalyzerWhenFastApiThrows() {
        MeetingAnalysisResult fallbackResult = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(), new MeetingMeta("정기회의", "2026-07-15", List.of())
        );
        when(fastApiMeetingClient.analyze(request)).thenThrow(new RuntimeException("연결 실패"));
        when(fallbackMeetingAnalyzer.analyze(request)).thenReturn(fallbackResult);

        newRunner().runAnalysis(9L, request, jobId, requestedBy);

        verify(meetingAnalysisPersistence).saveAnalysisSuccessForJob(9L, fallbackResult, "SPRING_FALLBACK", jobId, requestedBy);
    }

    @Test
    void savesFailureWhenBothFastApiAndFallbackThrow() {
        when(fastApiMeetingClient.analyze(request)).thenThrow(new RuntimeException("연결 실패"));
        when(fallbackMeetingAnalyzer.analyze(request)).thenThrow(new RuntimeException("fallback 실패"));

        newRunner().runAnalysis(9L, request, jobId, requestedBy);

        verify(meetingAnalysisPersistence).saveAnalysisFailureForJob(
            9L,
            MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE,
            jobId
        );
    }

    @Test
    void transcribesAudioFromStoredFileBeforeAnalyzingWhenTextIsBlank() throws Exception {
        Path audioFile = Files.createTempFile("meeting-audio", ".wav");
        Files.write(audioFile, "fake-audio-bytes".getBytes());
        Meeting meeting = new Meeting(
            1L, "음성 회의록", "audio", audioFile.toString(), "processing",
            LocalDate.now(), "정기회의", "meeting.wav", 10L, 10L
        );
        ReflectionTestUtils.setField(meeting, "id", 9L);
        when(meetingRepository.findById(9L)).thenReturn(Optional.of(meeting));
        when(fastApiMeetingClient.transcribeAudio("fake-audio-bytes".getBytes(), "meeting.wav"))
            .thenReturn("전사된 음성 텍스트");
        AiAnalyzeRequest audioRequest = new AiAnalyzeRequest(
            "demo-project", "음성 회의록", "2026-07-24", "정기회의", "audio", "meeting.wav", "", List.of("김민준")
        );
        MeetingAnalysisResult result = new MeetingAnalysisResult(
            "요약", List.of(), List.of(), List.of(), List.of(), new MeetingMeta("음성 회의록", "2026-07-24", List.of())
        );
        when(fastApiMeetingClient.analyze(any(AiAnalyzeRequest.class))).thenReturn(result);

        newRunner().runAnalysis(9L, audioRequest, jobId, requestedBy);

        assertThat(meeting.getTranscript()).isEqualTo("전사된 음성 텍스트");
        ArgumentCaptor<AiAnalyzeRequest> requestCaptor = ArgumentCaptor.forClass(AiAnalyzeRequest.class);
        verify(fastApiMeetingClient).analyze(requestCaptor.capture());
        assertThat(requestCaptor.getValue().text()).isEqualTo("전사된 음성 텍스트");
        verify(meetingAnalysisPersistence).saveAnalysisSuccessForJob(9L, result, "FASTAPI", jobId, requestedBy);
    }

    @Test
    void savesFailureWhenAudioTranscriptionFails() {
        Meeting meeting = new Meeting(
            1L, "음성 회의록", "audio", "/tmp/does-not-exist.wav", "processing",
            LocalDate.now(), "정기회의", "meeting.wav", 10L, 10L
        );
        ReflectionTestUtils.setField(meeting, "id", 9L);
        when(meetingRepository.findById(9L)).thenReturn(Optional.of(meeting));
        AiAnalyzeRequest audioRequest = new AiAnalyzeRequest(
            "demo-project", "음성 회의록", "2026-07-24", "정기회의", "audio", "meeting.wav", "", List.of("김민준")
        );

        newRunner().runAnalysis(9L, audioRequest, jobId, requestedBy);

        verify(meetingAnalysisPersistence).saveAnalysisFailureForJob(
            9L, "음성 파일에서 텍스트를 추출하지 못했습니다.", jobId
        );
        verify(fastApiMeetingClient, never()).analyze(any());
    }
}
