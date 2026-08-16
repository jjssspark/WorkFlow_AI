package com.workflowai.common;

import com.workflowai.project.InvitationException;
import com.workflowai.project.ProjectScheduleException;
import com.workflowai.security.InvalidTokenException;
import java.sql.SQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** PostgreSQL deadlock_detected. 대기 상한 초과(55P03)와 구분하는 유일한 단서다. */
    private static final String SQLSTATE_DEADLOCK = "40P01";

    /** 원인 사슬 순회 상한. 순환하는 사슬에서도 끝나게 한다 - {@link #isDeadlock} 참고. */
    private static final int MAX_CAUSE_DEPTH = 32;


    @ExceptionHandler(ProjectScheduleException.class)
    public ResponseEntity<ApiResponse<Void>> handleProjectSchedule(ProjectScheduleException e) {
        return ResponseEntity.badRequest().body(ApiResponse.fail(e.getCode(), e.getMessage()));
    }

    /** 초대 흐름이 의도해서 알리는 실패만 여기로 온다. 상태 코드는 예외 자신이 들고 있다. */
    @ExceptionHandler(InvitationException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvitation(InvitationException e) {
        return ResponseEntity.status(e.getStatus()).body(ApiResponse.fail(e.getCode(), e.getMessage()));
    }

    /** spring.servlet.multipart.max-file-size/max-request-size(application.yml) 초과 시 친절한 응답으로 바꾼다. */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleMaxUploadSizeExceeded(MaxUploadSizeExceededException e) {
        return ResponseEntity.status(413).body(ApiResponse.fail("FILE_TOO_LARGE", "파일 용량이 너무 큽니다."));
    }

    /**
     * 리프레시 토큰 거부(만료·위조·비밀번호 변경 이전 발급)는 서버 잘못이 아니라 "다시 로그인하라"는
     * 정상 응답이다. 핸들러가 없으면 500 + ERROR 스택트레이스로 나가, 클라이언트는 재시도 가능한
     * 장애로 오해하고 운영 로그는 오염된다.
     *
     * <p>응답 문구는 예외가 뭐라고 하든 하나로 고정한다. JwtService는 사유마다 다른 메시지를 던지므로
     * (서명 검증 실패 vs "토큰 타입이 올바르지 않습니다") 그대로 흘리면 응답이 사유별로 갈리고,
     * "이 계정은 방금 비밀번호를 바꿨다" 같은 사실이 새어나갈 수 있다.
     * AuthService.rejectIfIssuedBeforePasswordChange가 같은 이유로 예외·메시지를 맞춰둔 것과 같은 취지다.
     * 실제 사유는 서버 로그에만 남긴다.
     */
    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidToken(InvalidTokenException e) {
        log.debug("토큰 거부: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ApiResponse.fail("INVALID_TOKEN", "유효하지 않은 토큰입니다."));
    }

    /**
     * 행 잠금을 못 잡은 경우다. 대개 잠금 대기 상한(UserRepository#applyLockTimeout)에 걸린 것으로,
     * 같은 계정에 대한 비밀번호 변경이 진행 중이라 잠깐 못 읽은 것이지 서버 결함이 아니다. 그래서
     * 500이 아니라 "잠시 후 다시"로 안내한다. 상한이 없으면 이 요청은 커넥션을 붙든 채 무기한
     * 멈춰 있었을 것이다.
     *
     * <p>이 매핑은 인증 흐름 전용이 아니라 앱 전체에 걸린다 — 회의·업무에도 비관적 잠금이 있다.
     * 그쪽에는 대기 상한이 없어 실제로는 기다리다 성공하는 쪽이지만, 잠금 획득에 실패하면 역시
     * "재시도하면 되는 실패"라 같은 응답이 맞다.
     *
     * <p>단, 교착만은 경합이 아니라 결함이므로 로그 레벨을 갈라 놓는다 — {@link #isDeadlock} 참고.
     */
    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleLockFailure(PessimisticLockingFailureException e) {
        if (isDeadlock(e)) {
            log.error("행 잠금 교착 - 잠금 순서를 점검해야 한다", e);
        } else {
            log.warn("행 잠금 획득 실패: {}", e.getMessage());
        }
        return resourceBusy();
    }

    /**
     * 교착(SQLState 40P01)은 두 트랜잭션이 서로 반대 순서로 잠갔다는 뜻이라 경합이 아니라 코드
     * 결함이다. 대기 상한에 걸린 것(55P03)과 같은 WARN으로 흘리면 "잠깐 붐볐다"와 구분되지 않아
     * 조용히 묻힌다. 사용자에게 줄 응답은 같지만(진 쪽은 재시도하면 되므로 할 일이 다르지 않다)
     * 로그는 갈라야 사람이 알아챈다.
     *
     * <p>예외 <em>타입</em>으로 가르지 않는 이유가 있다. Spring은 6.0.3에서 교착 전용
     * {@code DeadlockLoserDataAccessException}을 폐기하고 이 둘을
     * {@link PessimisticLockingFailureException}/{@code CannotAcquireLockException}으로 합쳤다.
     * 그래서 타입으로 가르는 코드는 어느 쪽도 잡지 못하는 죽은 분기가 된다. 번역 단계를 넘어
     * 남아 있는 건 원인 사슬의 SQLState뿐이다.
     *
     * <p>순회에 깊이 상한을 두는 이유는, 원인 사슬이 순환할 수 있기 때문이다.
     * {@code Throwable.initCause}는 자기 자신을 원인으로 삼는 것만 막을 뿐 A→B→A처럼 두 예외가
     * 서로를 가리키는 경우는 막지 않는다. "cause가 자기 자신인가"만 보는 검사는 그 경우를 통과시켜
     * 무한 루프에 빠진다(실제로 그렇게 되는 것을 확인했다). 깊이로 끊으면 사슬 모양과 무관하게 끝난다.
     */
    private static boolean isDeadlock(Throwable e) {
        Throwable cause = e;
        for (int depth = 0; cause != null && depth < MAX_CAUSE_DEPTH; depth++, cause = cause.getCause()) {
            if (cause instanceof SQLException sqlException && SQLSTATE_DEADLOCK.equals(sqlException.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private ResponseEntity<ApiResponse<Void>> resourceBusy() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(ApiResponse.fail("RESOURCE_BUSY", "처리 중입니다. 잠시 후 다시 시도해주세요."));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodArgumentNotValid(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
            .findFirst()
            .map(error -> error.getDefaultMessage() == null ? "입력값을 확인해주세요." : error.getDefaultMessage())
            .orElse("입력값을 확인해주세요.");
        return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_REQUEST", message));
    }
}
