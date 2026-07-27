package com.workflowai.meeting;

import java.nio.file.Path;

/** 재생용으로 내려줄 회의록 음성 파일의 실제 경로와 원본 파일명. */
public record MeetingAudio(Path path, String fileName) {}
