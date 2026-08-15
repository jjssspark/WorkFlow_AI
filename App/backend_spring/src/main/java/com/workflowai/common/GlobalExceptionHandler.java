package com.workflowai.common;

import com.workflowai.project.InvitationException;
import com.workflowai.project.ProjectScheduleException;
import com.workflowai.security.InvalidTokenException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@RestControllerAdvice
public class GlobalExceptionHandler {

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
     * 장애로 오해하고 운영 로그는 오염된다. 사유는 구분하지 않는다 — 구분하면 "이 계정은 방금
     * 비밀번호를 바꿨다"가 응답으로 새어나간다(AuthService.rejectIfIssuedBeforePasswordChange 참고).
     */
    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidToken(InvalidTokenException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ApiResponse.fail("INVALID_TOKEN", e.getMessage()));
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
