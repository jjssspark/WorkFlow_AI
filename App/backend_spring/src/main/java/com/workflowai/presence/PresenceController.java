package com.workflowai.presence;

import com.workflowai.common.ApiResponse;
import com.workflowai.common.DemoDataService;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRole;
import com.workflowai.task.S3StorageClient;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "접속 상태", description = "중간보고/시연용 프로젝트 접속자 목록 (heartbeat 기반)")
@RestController
@RequestMapping("/api/v1/projects/{projectId}/presence")
public class PresenceController {
    private static final Logger log = LoggerFactory.getLogger(PresenceController.class);
    private static final int AVATAR_SIGNED_URL_EXPIRES_SECONDS = 24 * 60 * 60;
    // 서명 유효기간(24시간)보다 훨씬 짧게 잡아, 캐시된 URL이 만료된 서명을 들고 있을 일이 없게 한다.
    private static final Duration AVATAR_URL_CACHE_TTL = Duration.ofHours(1);

    private final Map<String, CachedAvatarUrl> signedAvatarUrlCache = new ConcurrentHashMap<>();
    private final ProjectMemberRepository projectMemberRepository;
    private final UserRepository userRepository;
    private final DemoDataService demoDataService;
    private final PresenceService presenceService;
    private final S3StorageClient storageClient;

    public PresenceController(
        ProjectMemberRepository projectMemberRepository,
        UserRepository userRepository,
        DemoDataService demoDataService,
        PresenceService presenceService,
        S3StorageClient storageClient
    ) {
        this.projectMemberRepository = projectMemberRepository;
        this.userRepository = userRepository;
        this.demoDataService = demoDataService;
        this.presenceService = presenceService;
        this.storageClient = storageClient;
    }

    /**
     * 접속자 아바타용 서명 URL. 접속자 목록은 부가 정보이므로 URL 발급이 실패해도 목록 자체는 그대로
     * 내려주고 사진만 null로 둔다 — 프론트가 이름 첫 글자 아바타로 대체한다.
     *
     * <p>이 목록은 프론트에서 5초마다 폴링한다. 서명 URL은 발급할 때마다 서명/타임스탬프 쿼리가 달라져
     * 매번 다른 문자열이 되는데, 그대로 내려보내면 {@code <img src>}가 폴링마다 바뀌어 브라우저가
     * 같은 사진을 5초마다 새로 내려받는다. 그래서 경로별로 발급한 URL을 재사용한다 — 사진을 바꾸면
     * 저장 경로(UUID)가 바뀌므로 새 URL이 즉시 반영된다.
     */
    private String avatarUrlOrNull(User user) {
        String path = user.getProfileImagePath();
        if (path == null) {
            return null;
        }
        Instant now = Instant.now();
        signedAvatarUrlCache.values().removeIf(cached -> !cached.isFreshAt(now));
        CachedAvatarUrl cached = signedAvatarUrlCache.get(path);
        if (cached != null) {
            return cached.url();
        }
        try {
            String url = storageClient.createSignedUrl(path, AVATAR_SIGNED_URL_EXPIRES_SECONDS, null);
            signedAvatarUrlCache.put(path, new CachedAvatarUrl(url, now.plus(AVATAR_URL_CACHE_TTL)));
            return url;
        } catch (RuntimeException e) {
            log.error("접속자 프로필 사진 서명 URL 발급 실패: userId={}, path={}", user.getId(), path, e);
            return null;
        }
    }

    private record CachedAvatarUrl(String url, Instant expiresAt) {
        boolean isFreshAt(Instant now) {
            return now.isBefore(expiresAt);
        }
    }

    @Operation(
        summary = "프로젝트 접속자 목록 조회",
        description = "heartbeat(TTL 40초) 기준으로 현재 접속 중인 프로젝트 멤버 목록을 반환한다. "
            + "프론트에서 10~30초 간격으로 폴링해 헤더의 접속자 아바타를 갱신하는 용도."
    )
    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<PresenceUserDto>> getPresence(
        @Parameter(description = "프로젝트 ID", example = "demo-project") @PathVariable String projectId
    ) {
        Long projectDbId = demoDataService.resolveProjectId(projectId);
        List<ProjectMember> members = projectMemberRepository.findAllByProjectId(projectDbId);
        List<Long> memberUserIds = members.stream().map(ProjectMember::getUserId).toList();
        List<Long> activeUserIds = presenceService.activeUserIds(memberUserIds);
        if (activeUserIds.isEmpty()) {
            return ApiResponse.ok(List.of());
        }

        Map<Long, User> usersById = userRepository.findAllById(activeUserIds).stream()
            .collect(Collectors.toMap(User::getId, user -> user));
        Map<Long, ProjectRole> roleByUserId = members.stream()
            .collect(Collectors.toMap(ProjectMember::getUserId, ProjectMember::getRole));

        List<PresenceUserDto> result = activeUserIds.stream()
            .map(userId -> {
                User user = usersById.get(userId);
                ProjectRole role = roleByUserId.get(userId);
                if (user == null || role == null) return null;
                return new PresenceUserDto(userId, user.getName(), role.toKorean(), avatarUrlOrNull(user));
            })
            .filter(Objects::nonNull)
            .toList();
        return ApiResponse.ok(result);
    }
}
