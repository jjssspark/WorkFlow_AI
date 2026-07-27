package com.workflowai.common;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * 서버 시스템 시각은 UTC로 고정되어 있고 엔티티의 createdAt 등은 LocalDateTime.now()로 채워진다.
 * DTO에서 LocalDateTime을 직접 String으로 미리 변환해 버리면(예: comment.getCreatedAt().toString())
 * JacksonConfig의 직렬화 커스터마이저를 거치지 않아 "Z"가 붙지 않고, 프론트의 new Date(iso)가
 * 오프셋 없는 문자열을 브라우저 로컬 타임존으로 오해석해 시각이 어긋난다.
 * DTO에서 LocalDateTime을 String으로 직접 변환해야 할 때는 반드시 이 헬퍼를 통해 "Z"를 붙인다.
 */
public final class UtcTimeFormat {
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    private UtcTimeFormat() {
    }

    public static String toIsoUtc(LocalDateTime dateTime) {
        return dateTime.format(FORMATTER);
    }
}
