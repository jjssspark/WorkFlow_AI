package com.workflowai.dashboard.controller;

import com.workflowai.common.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * com.workflowai.task.TaskAccessDeniedResponseAdvice와 내용은 같지만 이름을 다르게 둔다.
 * 두 클래스 모두 @RestControllerAdvice라 이름이 같으면 다른 @WebMvcTest들이(둘 다 클래스패스에 있으므로)
 * 기본 빈 이름 충돌(ConflictingBeanDefinitionException)을 일으킨다.
 */
@RestControllerAdvice
class DashboardAccessDeniedResponseAdvice {

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<Void>> handleAccessDenied() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
            .body(ApiResponse.fail("FORBIDDEN", "권한이 없습니다."));
    }
}
