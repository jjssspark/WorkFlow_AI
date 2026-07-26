package com.workflowai.admin;

import com.workflowai.admin.dto.RejectReviewerRequest;
import com.workflowai.admin.dto.ReviewerApplicationSummary;
import com.workflowai.common.ApiResponse;
import com.workflowai.common.PageResponse;
import com.workflowai.user.ReviewerStatus;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "관리자 - 심사자 승인", description = "심사자(REVIEWER) 가입 신청 조회/승인/거부. 전역 관리자만 접근 가능")
@RestController
@RequestMapping("/api/v1/admin/reviewers")
public class AdminReviewerController {
    private static final int MAX_PAGE_SIZE = 100;

    private final AdminReviewerService adminReviewerService;

    public AdminReviewerController(AdminReviewerService adminReviewerService) {
        this.adminReviewerService = adminReviewerService;
    }

    @PreAuthorize("@adminAccess.isAdmin()")
    @Operation(summary = "심사자 신청 목록", description = "status로 필터링한다(기본값 PENDING).")
    @GetMapping
    public ApiResponse<PageResponse<ReviewerApplicationSummary>> list(
        @RequestParam(defaultValue = "PENDING") ReviewerStatus status,
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "20") int size
    ) {
        // page/size는 프론트가 값을 검증한다고 가정할 수 없다 — 음수 page나 과도한 size가
        // PageRequest.of()에서 예외를 던지거나 지나치게 큰 조회를 유발하지 않도록 여기서 정리한다.
        int safePage = Math.max(page, 0);
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        var pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ApiResponse.ok(adminReviewerService.listApplications(status, pageable));
    }

    @PreAuthorize("@adminAccess.isAdmin()")
    @Operation(summary = "심사자 신청 승인")
    @PostMapping("/{userId}/approve")
    public ResponseEntity<ApiResponse<Void>> approve(@PathVariable Long userId) {
        try {
            adminReviewerService.approve(userId);
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (ReviewerStatusConflictException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.fail("REVIEWER_STATUS_CONFLICT", e.getMessage()));
        }
    }

    @PreAuthorize("@adminAccess.isAdmin()")
    @Operation(summary = "심사자 신청 거부")
    @PostMapping("/{userId}/reject")
    public ResponseEntity<ApiResponse<Void>> reject(
        @PathVariable Long userId, @Valid @RequestBody RejectReviewerRequest request
    ) {
        try {
            adminReviewerService.reject(userId, request.reason());
            return ResponseEntity.ok(ApiResponse.ok(null));
        } catch (ReviewerStatusConflictException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.fail("REVIEWER_STATUS_CONFLICT", e.getMessage()));
        }
    }
}
