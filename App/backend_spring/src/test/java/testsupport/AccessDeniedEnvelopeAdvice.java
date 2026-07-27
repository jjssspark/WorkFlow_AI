package testsupport;

import com.workflowai.common.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * @WebMvcTest 슬라이스에서 권한 거부 응답을 운영과 같은 모양으로 만들어 주는 테스트 전용 어드바이스.
 *
 * <p>운영에서는 SecurityConfig의 accessDeniedHandler가 이 응답을 만든다. 그런데 @WebMvcTest는
 * SecurityConfig를 로드하지 않으므로, 슬라이스 테스트에서는 권한 거부가 envelope 없이 끝난다.
 * 그래서 슬라이스가 컨트롤러의 @PreAuthorize를 검증하려면 이런 대역이 필요하다.
 *
 * <p><strong>패키지가 com.workflowai 밖인 것이 핵심이다.</strong> 이전에는 같은 내용의 클래스가
 * com.workflowai 하위 다섯 곳에 흩어져 있었다. @RestControllerAdvice는 @Component이고
 * @SpringBootTest는 com.workflowai를 컴포넌트 스캔하면서 테스트 클래스패스까지 훑기 때문에,
 * 이 대역들이 통합 테스트의 실제 애플리케이션 컨텍스트에 등록됐다. 그 결과 통합 테스트에서
 * 403을 만든 주체가 운영 코드가 아니라 이 대역이었고, 두 응답 본문이 우연히 같아서 아무도 몰랐다.
 * SecurityConfig의 403 코드를 바꿔도 통합 테스트가 통과하는 것으로 확인했다.
 *
 * <p>여기로 옮기면 스캔에 걸리지 않는다. 필요한 슬라이스만 @Bean으로 명시 등록해 쓴다.
 * 원래도 각 테스트가 @Bean으로 직접 등록하고 있었으므로 슬라이스 쪽 동작은 달라지지 않는다.
 *
 * <p>다섯 벌을 한 벌로 합쳤다. 이름을 나눠 뒀던 이유가 "여러 개가 동시에 스캔될 때의 빈 이름 충돌"
 * 이었는데, 스캔되지 않으면 그 문제 자체가 사라진다.
 */
@RestControllerAdvice
public class AccessDeniedEnvelopeAdvice {

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<Void>> handleAccessDenied() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiResponse.fail("FORBIDDEN", "권한이 없습니다."));
    }
}
