package com.workflowai.auth;

import com.workflowai.comment.PersonalComment;
import com.workflowai.comment.PersonalCommentDto;
import com.workflowai.comment.PersonalCommentRepository;
import com.workflowai.common.ApiResponse;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.security.CurrentUser;
import com.workflowai.task.S3StorageClient;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "내 정보", description = "현재 로그인한 사용자의 기본 정보 및 역할 요약")
@RestController
@RequestMapping("/api/v1/me")
public class MeController {
    private static final Logger log = LoggerFactory.getLogger(MeController.class);
    private static final int AVATAR_SIGNED_URL_EXPIRES_SECONDS = 24 * 60 * 60;
    private static final long AVATAR_MAX_BYTES = 10L * 1024 * 1024;
    private static final int AVATAR_MAX_DIMENSION = 2000;
    private static final int MAX_NAME_LENGTH = 100;
    private static final int MAX_AFFILIATION_LENGTH = 100;
    private static final int MAX_FIELD_TAGS = 10;
    private static final int MAX_FIELD_TAG_LENGTH = 30;
    private static final String TARGET_TYPE_PERSONAL = "personal";
    // GitHub 아이디 규칙: 영숫자로 시작, 하이픈은 연속/끝에 올 수 없음, 최대 39자.
    private static final java.util.regex.Pattern GITHUB_USERNAME_PATTERN =
        java.util.regex.Pattern.compile("^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$");

    private final UserRepository userRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final S3StorageClient storageClient;
    private final PersonalCommentRepository personalCommentRepository;

    public MeController(
        UserRepository userRepository,
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        S3StorageClient storageClient,
        PersonalCommentRepository personalCommentRepository
    ) {
        this.userRepository = userRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.storageClient = storageClient;
        this.personalCommentRepository = personalCommentRepository;
    }

    private User currentUserOrThrow() {
        return userRepository.findById(CurrentUser.id())
            .orElseThrow(() -> new IllegalStateException("사용자를 찾을 수 없습니다."));
    }

    private String avatarUrlOrNull(User user) {
        if (user.getProfileImagePath() == null) {
            return null;
        }
        try {
            return storageClient.createSignedUrl(user.getProfileImagePath(), AVATAR_SIGNED_URL_EXPIRES_SECONDS, null);
        } catch (RuntimeException e) {
            log.error("프로필 사진 서명 URL 발급 실패: userId={}, path={}", user.getId(), user.getProfileImagePath(), e);
            return null;
        }
    }

    private UserSummary toSummary(User user) {
        return new UserSummary(
            user.getId(), user.getEmail(), user.getName(),
            user.getAffiliation(), user.getFieldTags(), user.getGithubUsername(), avatarUrlOrNull(user),
            user.isAdmin()
        );
    }

    @Operation(summary = "내 정보 조회", description = "현재 로그인한 사용자의 기본 정보와 프로젝트별 역할을 조회한다.")
    @GetMapping
    public ApiResponse<MeResponse> me() {
        User user = currentUserOrThrow();

        List<ProjectMember> memberships = projectMemberRepository.findAllByUserId(user.getId());
        Map<Long, Project> projectsById = projectRepository
            .findAllById(memberships.stream().map(ProjectMember::getProjectId).toList())
            .stream()
            .collect(Collectors.toMap(Project::getId, project -> project));

        List<ProjectRoleSummary> projectRoles = memberships.stream()
            .map(pm -> {
                Project project = projectsById.get(pm.getProjectId());
                String title = project != null ? project.getTitle() : null;
                return new ProjectRoleSummary(pm.getProjectId(), title, pm.getRole().toKorean());
            })
            .toList();

        return ApiResponse.ok(new MeResponse(toSummary(user), projectRoles));
    }

    @Operation(summary = "내 프로필 수정", description = "이름/소속/분야/GitHub 아이디를 수정한다.")
    @PutMapping("/profile")
    public ResponseEntity<ApiResponse<UserSummary>> updateProfile(@RequestBody UpdateProfileRequest request) {
        if (request.name() == null || request.name().isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("NAME_REQUIRED", "이름은 필수입니다."));
        }
        if (request.name().length() > MAX_NAME_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("NAME_TOO_LONG", "이름은 " + MAX_NAME_LENGTH + "자를 초과할 수 없습니다."));
        }
        if (request.affiliation() != null && request.affiliation().length() > MAX_AFFILIATION_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("AFFILIATION_TOO_LONG", "소속은 " + MAX_AFFILIATION_LENGTH + "자를 초과할 수 없습니다."));
        }
        String githubUsername = blankToNull(request.githubUsername());
        if (githubUsername != null && !GITHUB_USERNAME_PATTERN.matcher(githubUsername).matches()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(
                "GITHUB_USERNAME_INVALID", "GitHub 아이디 형식이 올바르지 않습니다(영숫자와 하이픈만, 하이픈으로 시작/연속/끝날 수 없음, 최대 39자)."
            ));
        }

        List<String> normalizedFieldTags = normalizeFieldTags(request.field());
        if (normalizedFieldTags.size() > MAX_FIELD_TAGS) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("TOO_MANY_FIELD_TAGS", "분야는 최대 " + MAX_FIELD_TAGS + "개까지 등록할 수 있습니다."));
        }
        boolean hasOversizedTag = normalizedFieldTags.stream().anyMatch(tag -> tag.length() > MAX_FIELD_TAG_LENGTH);
        if (hasOversizedTag) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FIELD_TAG_TOO_LONG", "분야 하나는 " + MAX_FIELD_TAG_LENGTH + "자를 초과할 수 없습니다."));
        }

        User user = currentUserOrThrow();
        user.setName(request.name().trim());
        user.setAffiliation(blankToNull(request.affiliation()));
        user.setFieldTags(normalizedFieldTags);
        user.setGithubUsername(githubUsername);
        userRepository.save(user);

        return ResponseEntity.ok(ApiResponse.ok(toSummary(user)));
    }

    /** null/공백 태그를 걸러내고, 앞뒤 공백을 정리한 뒤 중복을 제거한다(먼저 나온 값을 유지). */
    private List<String> normalizeFieldTags(List<String> rawTags) {
        if (rawTags == null) {
            return List.of();
        }
        java.util.LinkedHashSet<String> deduped = new java.util.LinkedHashSet<>();
        for (String tag : rawTags) {
            if (tag == null) {
                continue;
            }
            String trimmed = tag.trim();
            if (!trimmed.isEmpty()) {
                deduped.add(trimmed);
            }
        }
        return new java.util.ArrayList<>(deduped);
    }

    private static final byte[] PNG_MAGIC = { (byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
    private static final byte[] JPEG_MAGIC = { (byte) 0xFF, (byte) 0xD8, (byte) 0xFF };

    /**
     * 클라이언트가 보내는 Content-Type 헤더는 그대로 조작할 수 있으므로 신뢰하지 않는다 — 실제 파일의
     * 첫 바이트(매직 넘버)로 PNG/JPEG 여부를 직접 판정한다. 둘 다 아니면 null(허용하지 않는 파일).
     */
    private String detectImageContentType(byte[] bytes) {
        if (startsWith(bytes, PNG_MAGIC)) {
            return "image/png";
        }
        if (startsWith(bytes, JPEG_MAGIC)) {
            return "image/jpeg";
        }
        return null;
    }

    private boolean startsWith(byte[] data, byte[] prefix) {
        if (data.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (data[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * ImageIO.read()로 픽셀을 전부 디코딩하지 않고, 리더가 노출하는 헤더 정보만으로 width/height를 구한다.
     * PNG/JPEG 헤더는 파일 앞부분에 있어 몇 KB만 파싱해도 해상도를 알 수 있다 — 이 값으로 먼저 걸러내면
     * 실제 픽셀 버퍼(가로*세로*채널)를 할당하기 전에 지나치게 큰 이미지를 차단할 수 있다.
     * 유효한 이미지가 아니면 null을 반환한다.
     */
    private int[] readImageDimensions(byte[] bytes) throws IOException {
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            if (iis == null) {
                return null;
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(iis);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(iis, true, true);
                return new int[] { reader.getWidth(0), reader.getHeight(0) };
            } catch (RuntimeException e) {
                // 헤더가 형식은 맞지만 내용이 손상된 파일 — 유효하지 않은 이미지로 처리한다.
                return null;
            } finally {
                reader.dispose();
            }
        }
    }

    @Operation(summary = "프로필 사진 업로드", description = "PNG/JPG, 10MB 이하, 가로세로 2000px 이하만 허용한다.")
    @PostMapping(value = "/avatar")
    public ResponseEntity<ApiResponse<UserSummary>> uploadAvatar(@RequestParam MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FILE_REQUIRED", "파일이 비어있습니다."));
        }
        if (file.getSize() > AVATAR_MAX_BYTES) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FILE_TOO_LARGE", "파일 용량은 10MB를 초과할 수 없습니다."));
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FILE_READ_FAILED", "파일을 읽을 수 없습니다."));
        }

        // 클라이언트가 보낸 Content-Type 헤더는 신뢰하지 않는다 — 실제 파일 바이트(매직 넘버)로 PNG/JPEG
        // 여부를 직접 판정한다. 예: .png 확장자에 실행 파일을 넣어 보내는 위장 업로드를 여기서 막는다.
        String contentType = detectImageContentType(bytes);
        if (contentType == null) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("UNSUPPORTED_FILE_TYPE", "PNG 또는 JPG 파일만 업로드할 수 있습니다."));
        }

        // ImageIO.read()로 픽셀 전체를 디코딩하면, 작은 파일이 극단적으로 큰 해상도로 압축되어 있는
        // "압축 폭탄"에 메모리를 다 써버릴 수 있다. 전체 디코딩 전에 ImageReader로 헤더(메타데이터)만
        // 읽어 해상도부터 확인하고, 넘으면 픽셀 버퍼를 만들지 않고 바로 거부한다.
        try {
            int[] dimensions = readImageDimensions(bytes);
            if (dimensions == null) {
                return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_IMAGE", "올바른 이미지 파일이 아닙니다."));
            }
            if (dimensions[0] > AVATAR_MAX_DIMENSION || dimensions[1] > AVATAR_MAX_DIMENSION) {
                return ResponseEntity.badRequest().body(ApiResponse.fail(
                    "IMAGE_TOO_LARGE", "이미지 크기는 " + AVATAR_MAX_DIMENSION + "x" + AVATAR_MAX_DIMENSION + " 이하여야 합니다."
                ));
            }
        } catch (IOException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_IMAGE", "올바른 이미지 파일이 아닙니다."));
        }

        // 여기까지 왔으면 해상도가 이미 AVATAR_MAX_DIMENSION 이하로 확정됐으므로, 전체 디코딩을 해도
        // 메모리 사용량이 최대 2000x2000 픽셀로 제한된다 — 이제는 안전하게 픽셀까지 디코딩해서 헤더만
        // 그럴듯하고 실제 픽셀 데이터는 잘려있거나 손상된 파일(예: 앞부분만 유효한 PNG 헤더 + 쓰레기 데이터)을 걸러낸다.
        try {
            if (ImageIO.read(new ByteArrayInputStream(bytes)) == null) {
                return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_IMAGE", "손상된 이미지 파일입니다."));
            }
        } catch (IOException | RuntimeException e) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_IMAGE", "손상된 이미지 파일입니다."));
        }

        User user = currentUserOrThrow();
        String extension = "image/png".equals(contentType) ? "png" : "jpg";
        String storagePath = "avatars/" + user.getId() + "/" + UUID.randomUUID() + "." + extension;
        String previousPath = user.getProfileImagePath();

        try (ByteArrayInputStream in = new ByteArrayInputStream(bytes)) {
            storageClient.upload(storagePath, in, bytes.length, contentType);
        } catch (IOException | RuntimeException e) {
            log.error("프로필 사진 업로드 실패: userId={}, path={}", user.getId(), storagePath, e);
            return ResponseEntity.status(502).body(ApiResponse.fail("STORAGE_UPLOAD_FAILED", "프로필 사진 업로드에 실패했습니다."));
        }

        user.setProfileImagePath(storagePath);
        try {
            userRepository.save(user);
        } catch (RuntimeException e) {
            // DB 저장이 실패하면 방금 올린 오브젝트가 어떤 User에도 연결되지 못한 채 고아로 남는다 —
            // 실패를 그냥 삼키지 않고 스토리지에서 정리해, 실패한 업로드가 용량만 차지하지 않게 한다.
            log.error("프로필 사진 경로 저장 실패, 방금 업로드한 Storage 객체를 정리합니다: userId={}, path={}", user.getId(), storagePath, e);
            try {
                storageClient.delete(storagePath);
            } catch (RuntimeException cleanupError) {
                log.error("업로드 실패 후 Storage 객체 정리도 실패(고아 객체로 남을 수 있음): path={}", storagePath, cleanupError);
            }
            return ResponseEntity.status(500).body(ApiResponse.fail("PROFILE_SAVE_FAILED", "프로필 사진 정보를 저장하지 못했습니다."));
        }

        if (previousPath != null) {
            try {
                storageClient.delete(previousPath);
            } catch (RuntimeException e) {
                log.error("이전 프로필 사진 정리 실패(고아 객체로 남을 수 있음): path={}", previousPath, e);
            }
        }

        return ResponseEntity.ok(ApiResponse.ok(toSummary(user)));
    }

    private String blankToNull(String value) {
        return (value == null || value.isBlank()) ? null : value.trim();
    }

    @Operation(
        summary = "내가 담당한 업무 목록",
        description = "업무 데이터 연동은 회의록/업무 보드 담당 기능에서 채워진다. 현재는 빈 목록을 반환하는 스텁이다."
    )
    @GetMapping("/tasks")
    public ApiResponse<List<Object>> myTasks() {
        return ApiResponse.ok(List.of());
    }

    @Operation(
        summary = "내가 받은/작성한 개인 코멘트",
        description = "심사자가 남긴 코멘트와 그에 대한 답글을 시간순으로 최대 10건 반환한다."
    )
    @GetMapping("/comments")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<PersonalCommentDto>> myComments(@RequestParam Long projectId) {
        Long userId = CurrentUser.id();
        List<PersonalComment> items = personalCommentRepository
            .findByProjectIdAndTargetTypeAndTargetUserIdOrderByCreatedAtAsc(projectId, TARGET_TYPE_PERSONAL, userId);
        Map<Long, User> userCache = userRepository.findAllById(
            items.stream().map(PersonalComment::getAuthorId).distinct().toList()
        ).stream().collect(Collectors.toMap(User::getId, u -> u));
        List<PersonalCommentDto> dtos = items.stream()
            .map(c -> PersonalCommentDto.from(
                c, userCache.containsKey(c.getAuthorId()) ? userCache.get(c.getAuthorId()).getName() : "알 수 없음"
            ))
            .toList();
        return ApiResponse.ok(dtos);
    }
}
