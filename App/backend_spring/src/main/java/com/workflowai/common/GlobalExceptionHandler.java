package com.workflowai.common;

import com.workflowai.project.InvitationException;
import com.workflowai.project.ProjectScheduleException;
import com.workflowai.security.InvalidTokenException;
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
     * 잠금 대기 상한(UserRepository#applyLockTimeout)에 걸린 경우다. 같은 계정에 대한 비밀번호
     * 변경이 진행 중이라 잠깐 못 읽은 것이지 서버 결함이 아니므로, 500이 아니라 "잠시 후 다시"로
     * 안내한다. 상한이 없으면 이 요청은 커넥션을 붙든 채 무기한 멈춰 있었을 것이다.
     */
    @ExceptionHandler(PessimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleLockTimeout(PessimisticLockingFailureException e) {
        log.warn("행 잠금 획득 실패: {}", e.getMessage());
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
