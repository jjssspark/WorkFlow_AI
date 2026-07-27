package com.workflowai;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class WorkFlowAiBackendApplication {
    public static void main(String[] args) {
        // 엔티티 전반의 createdAt/updatedAt이 LocalDateTime.now()(JVM 기본 타임존 기준)로 채워지고,
        // JacksonConfig/UtcTimeFormat이 이를 UTC로 간주해 "Z"를 붙여 직렬화한다. 이 값이 실제로
        // UTC이려면 JVM 기본 타임존이 UTC여야 하는데, 그동안은 컨테이너 OS 설정(TZ 미지정)에
        // 암묵적으로 의존하고 있었다 - 배포 환경이 바뀌어 컨테이너 TZ가 UTC가 아니게 되면 전체 API
        // 시각이 조용히 틀어진다. 코드 차원에서 명시적으로 고정해 배포 환경 설정과 무관하게 만든다.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        DatabaseUrlPropertyMapper.apply();
        SpringApplication.run(WorkFlowAiBackendApplication.class, args);
    }
}
