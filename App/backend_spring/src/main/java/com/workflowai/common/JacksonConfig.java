package com.workflowai.common;

import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import java.time.format.DateTimeFormatter;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 엔티티의 createdAt/updatedAt 등은 전부 LocalDateTime.now()로 채워지고, 컨테이너 시스템 시각은
 * UTC로 고정되어 있다(TZ 미설정). 그런데 LocalDateTime은 오프셋 정보가 없어 기본 직렬화 결과에
 * "Z"가 붙지 않고, 프론트의 new Date(iso)는 오프셋 없는 문자열을 브라우저 로컬 타임존으로 오해석한다.
 * 그 결과 KST 브라우저 기준으로 알림/코멘트/상태변경 시각이 실제보다 9시간 이르게 표시되던 버그가 있었다.
 * 여기서 명시적으로 "Z"를 붙여 UTC임을 알려주면 new Date(iso)가 항상 올바른 절대 시각으로 해석한다.
 * DTO에서 LocalDateTime을 미리 String으로 변환하는 곳(ActivityDto 등)은 이 빈을 거치지 않으므로
 * 반드시 UtcTimeFormat.toIsoUtc()를 대신 써야 한다 - 아래 포맷과 동일하게 맞춰져 있다.
 */
@Configuration
public class JacksonConfig {

    private static final DateTimeFormatter UTC_LOCAL_DATE_TIME_FORMATTER =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer utcLocalDateTimeCustomizer() {
        return builder -> builder.serializers(new LocalDateTimeSerializer(UTC_LOCAL_DATE_TIME_FORMATTER));
    }
}
