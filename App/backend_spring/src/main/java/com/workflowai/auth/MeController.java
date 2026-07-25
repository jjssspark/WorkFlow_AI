package com.workflowai.auth;

import com.workflowai.common.ApiResponse;
import com.workflowai.project.Project;
import com.workflowai.project.ProjectMember;
import com.workflowai.project.ProjectMemberRepository;
import com.workflowai.project.ProjectRepository;
import com.workflowai.security.CurrentUser;
import com.workflowai.task.SupabaseStorageClient;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
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
    private static final int MAX_GITHUB_USERNAME_LENGTH = 100;
    private static final int MAX_FIELD_TAGS = 10;
    private static final int MAX_FIELD_TAG_LENGTH = 30;

    private final UserRepository userRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectRepository projectRepository;
    private final SupabaseStorageClient storageClient;

    public MeController(
        UserRepository userRepository,
        ProjectMemberRepository projectMemberRepository,
        ProjectRepository projectRepository,
        SupabaseStorageClient storageClient
    ) {
        this.userRepository = userRepository;
        this.projectMemberRepository = projectMemberRepository;
        this.projectRepository = projectRepository;
        this.storageClient = storageClient;
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
            user.getAffiliation(), user.getFieldTags(), user.getGithubUsername(), avatarUrlOrNull(user)
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
        if (request.githubUsername() != null && request.githubUsername().length() > MAX_GITHUB_USERNAME_LENGTH) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("GITHUB_USERNAME_TOO_LONG", "GitHub 아이디는 " + MAX_GITHUB_USERNAME_LENGTH + "자를 초과할 수 없습니다."));
        }
        if (request.field() != null) {
            if (request.field().size() > MAX_FIELD_TAGS) {
                return ResponseEntity.badRequest().body(ApiResponse.fail("TOO_MANY_FIELD_TAGS", "분야는 최대 " + MAX_FIELD_TAGS + "개까지 등록할 수 있습니다."));
            }
            boolean hasOversizedTag = request.field().stream().anyMatch(tag -> tag != null && tag.length() > MAX_FIELD_TAG_LENGTH);
            if (hasOversizedTag) {
                return ResponseEntity.badRequest().body(ApiResponse.fail("FIELD_TAG_TOO_LONG", "분야 하나는 " + MAX_FIELD_TAG_LENGTH + "자를 초과할 수 없습니다."));
            }
        }

        User user = currentUserOrThrow();
        user.setName(request.name().trim());
        user.setAffiliation(blankToNull(request.affiliation()));
        user.setFieldTags(request.field() == null ? List.of() : request.field());
        user.setGithubUsername(blankToNull(request.githubUsername()));
        userRepository.save(user);

        return ResponseEntity.ok(ApiResponse.ok(toSummary(user)));
    }

    @Operation(summary = "프로필 사진 업로드", description = "PNG/JPG, 10MB 이하, 가로세로 2000px 이하만 허용한다.")
    @PostMapping(value = "/avatar")
    public ResponseEntity<ApiResponse<UserSummary>> uploadAvatar(@RequestParam MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("FILE_REQUIRED", "파일이 비어있습니다."));
        }
        String contentType = file.getContentType();
        if (!"image/png".equalsIgnoreCase(contentType) && !"image/jpeg".equalsIgnoreCase(contentType)) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("UNSUPPORTED_FILE_TYPE", "PNG 또는 JPG 파일만 업로드할 수 있습니다."));
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

        BufferedImage image;
        try {
            image = ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException e) {
            image = null;
        }
        if (image == null) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("INVALID_IMAGE", "올바른 이미지 파일이 아닙니다."));
        }
        if (image.getWidth() > AVATAR_MAX_DIMENSION || image.getHeight() > AVATAR_MAX_DIMENSION) {
            return ResponseEntity.badRequest().body(ApiResponse.fail(
                "IMAGE_TOO_LARGE", "이미지 크기는 " + AVATAR_MAX_DIMENSION + "x" + AVATAR_MAX_DIMENSION + " 이하여야 합니다."
            ));
        }

        User user = currentUserOrThrow();
        String extension = "image/png".equalsIgnoreCase(contentType) ? "png" : "jpg";
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
        description = "코멘트 데이터 연동은 별도 기능 담당에서 채워진다. 현재는 빈 목록을 반환하는 스텁이다."
    )
    @GetMapping("/comments")
    public ApiResponse<List<Object>> myComments() {
        return ApiResponse.ok(List.of());
    }
}
