package com.workflowai.notification;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Objects;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "알림", description = "로그인 사용자의 알림 조회/읽음 처리 API")
@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
    private final NotificationRepository notificationRepository;

    public NotificationController(NotificationRepository notificationRepository) {
        this.notificationRepository = notificationRepository;
    }

    @Operation(summary = "내 알림 목록 조회", description = "로그인 사용자의 알림을 최신순으로 최대 50건 조회합니다.")
    @GetMapping
    public ResponseEntity<ApiResponse<List<NotificationDto>>> getNotifications() {
        Long userId = CurrentUser.id();
        List<NotificationDto> notifications = notificationRepository
            .findTop50ByUserIdOrderByCreatedAtDesc(userId)
            .stream()
            .map(NotificationDto::from)
            .toList();
        return ResponseEntity.ok(ApiResponse.ok(notifications));
    }

    @Operation(summary = "안 읽은 알림 개수 조회")
    @GetMapping("/unread-count")
    public ResponseEntity<ApiResponse<UnreadCountResponse>> getUnreadCount() {
        Long userId = CurrentUser.id();
        long count = notificationRepository.countByUserIdAndReadFalse(userId);
        return ResponseEntity.ok(ApiResponse.ok(new UnreadCountResponse(count)));
    }

    @Operation(
        summary = "지정한 알림 읽음 처리",
        description = "요청에 담긴 id들만 읽음 처리한다. 다른 사용자의 알림 id가 섞여 있으면 조용히 무시한다. "
            + "\"전체 읽음\" 대신 이 방식을 쓰는 이유: 클라이언트가 방금 화면에 보여준 알림들만 읽음 처리해야, "
            + "목록을 불러온 뒤에 새로 도착한 알림이 사용자가 보지도 못한 채로 읽음 처리되는 경쟁 조건을 막을 수 있다."
    )
    @PatchMapping("/read")
    public ResponseEntity<ApiResponse<Void>> markRead(@RequestBody MarkNotificationsReadRequest request) {
        if (request.ids() == null || request.ids().isEmpty()) {
            return ResponseEntity.ok(ApiResponse.ok(null));
        }
        // 목록 조회가 최신순 최대 50건이므로, 정상적인 클라이언트라면 ids도 그 범위를 넘지 않는다.
        // null/음수/중복 id 및 비정상적으로 큰 요청을 방어적으로 걸러낸다.
        List<Long> normalizedIds = request.ids().stream()
            .filter(Objects::nonNull)
            .filter(id -> id > 0)
            .distinct()
            .limit(50)
            .toList();
        if (normalizedIds.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.ok(null));
        }
        Long userId = CurrentUser.id();
        List<Notification> owned = notificationRepository.findByIdInAndUserId(normalizedIds, userId);
        owned.forEach(Notification::markRead);
        notificationRepository.saveAll(owned);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
