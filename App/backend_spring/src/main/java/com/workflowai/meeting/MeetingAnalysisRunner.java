package com.workflowai.meeting;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class MeetingAnalysisRunner {
    private static final Logger log = LoggerFactory.getLogger(MeetingAnalysisRunner.class);
    private static final String AUDIO_SOURCE_TYPE = "audio";
    private static final String AUDIO_TRANSCRIPTION_FAILED_MESSAGE = "음성 파일에서 텍스트를 추출하지 못했습니다.";

    private final FastApiMeetingClient fastApiMeetingClient;
    private final FallbackMeetingAnalyzer fallbackMeetingAnalyzer;
    private final MeetingAnalysisPersistence meetingAnalysisPersistence;
    private final MeetingRepository meetingRepository;

    public MeetingAnalysisRunner(
        FastApiMeetingClient fastApiMeetingClient,
        FallbackMeetingAnalyzer fallbackMeetingAnalyzer,
        MeetingAnalysisPersistence meetingAnalysisPersistence,
        MeetingRepository meetingRepository
    ) {
        this.fastApiMeetingClient = fastApiMeetingClient;
        this.fallbackMeetingAnalyzer = fallbackMeetingAnalyzer;
        this.meetingAnalysisPersistence = meetingAnalysisPersistence;
        this.meetingRepository = meetingRepository;
    }

    public void runAnalysis(Long meetingId, AiAnalyzeRequest request, UUID jobId, Long requestedBy) {
        if (!meetingAnalysisPersistence.claimJob(meetingId, jobId)) {
            log.info("Skipping stale meeting analysis job. meetingId={}", meetingId);
            return;
        }

        AiAnalyzeRequest resolvedRequest = request;
        if (AUDIO_SOURCE_TYPE.equals(request.source_type()) && isBlank(request.text())) {
            try {
                resolvedRequest = withTranscribedAudioText(meetingId, request);
            } catch (Exception e) {
                log.warn("음성 회의록 STT 실패. meetingId={}", meetingId, e);
                meetingAnalysisPersistence.saveAnalysisFailureForJob(meetingId, AUDIO_TRANSCRIPTION_FAILED_MESSAGE, jobId);
                return;
            }
        }

        MeetingAnalysisResult result;
        String analysisSource;
        try {
            MeetingAnalysisResult fastApiResult;
            try {
                fastApiResult = fastApiMeetingClient.analyze(resolvedRequest);
            } catch (Exception e) {
                log.warn("FastAPI meeting analysis failed. meetingId={}, fallback=SPRING_FALLBACK", meetingId, e);
                fastApiResult = null;
            }
            if (fastApiResult != null) {
                result = fastApiResult;
                analysisSource = "FASTAPI";
            } else {
                result = fallbackMeetingAnalyzer.analyze(resolvedRequest);
                analysisSource = "SPRING_FALLBACK";
            }
        } catch (Exception e) {
            log.warn("Meeting analysis failed after FastAPI/fallback attempts. meetingId={}", meetingId, e);
            meetingAnalysisPersistence.saveAnalysisFailureForJob(
                meetingId,
                MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE,
                jobId
            );
            return;
        }

        try {
            meetingAnalysisPersistence.saveAnalysisSuccessForJob(meetingId, result, analysisSource, jobId, requestedBy);
        } catch (Exception e) {
            log.warn("Meeting analysis persistence failed. meetingId={}", meetingId, e);
            meetingAnalysisPersistence.saveAnalysisFailureForJob(
                meetingId,
                MeetingAnalysisPersistence.DEFAULT_ANALYSIS_ERROR_MESSAGE,
                jobId
            );
        }
    }

    /** 음성 회의록은 analyze() 요청 단계에서 STT를 하지 않으므로(타임아웃 위험), 큐 실행 시점에 여기서 처리한다. */
    private AiAnalyzeRequest withTranscribedAudioText(Long meetingId, AiAnalyzeRequest request) throws IOException {
        Meeting meeting = meetingRepository.findById(meetingId)
            .orElseThrow(() -> new IllegalStateException("회의록을 찾을 수 없습니다: " + meetingId));
        String filePath = meeting.getFilePath();
        if (isBlank(filePath)) {
            throw new IllegalStateException("저장된 음성 파일 경로가 없습니다: meetingId=" + meetingId);
        }
        byte[] bytes = Files.readAllBytes(Path.of(filePath));
        String text = fastApiMeetingClient.transcribeAudio(bytes, meeting.getOriginalFileName());
        if (isBlank(text)) {
            throw new IllegalStateException(AUDIO_TRANSCRIPTION_FAILED_MESSAGE);
        }
        meeting.setTranscript(text);
        meetingRepository.save(meeting);
        return new AiAnalyzeRequest(
            request.project_id(),
            request.title(),
            request.meeting_date(),
            request.meeting_kind(),
            request.source_type(),
            request.file_name(),
            text,
            request.participants()
        );
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
