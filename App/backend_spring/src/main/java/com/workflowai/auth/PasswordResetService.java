package com.workflowai.auth;

import com.workflowai.common.mail.AsyncMailDispatcher;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 비밀번호 재설정.
 *
 * <p>요청 단계는 계정 존재 여부를 절대 드러내지 않는다 — 없는 계정, Google 계정, 로컬 계정이
 * 모두 같은 응답을 받는다. 실제 차이는 메일 내용에서만 생기고, 메일은 계정 주인만 받는다.
 */
@Service
public class PasswordResetService {
    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

    private static final int TOKEN_BYTES = 32;
    private static final int TOKEN_TTL_MINUTES = 30;
    private static final String PROVIDER_LOCAL = "local";

    private final UserRepository userRepository;
    private final PasswordResetTokenRepository tokenRepository;
    private final AsyncMailDispatcher asyncMailDispatcher;
    private final PasswordEncoder passwordEncoder;
    private final String frontendBaseUrl;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(
        UserRepository userRepository,
        PasswordResetTokenRepository tokenRepository,
        AsyncMailDispatcher asyncMailDispatcher,
        PasswordEncoder passwordEncoder,
        @Value("${workflow.frontend.base-url}") String frontendBaseUrl
    ) {
        this.userRepository = userRepository;
        this.tokenRepository = tokenRepository;
        this.asyncMailDispatcher = asyncMailDispatcher;
        this.passwordEncoder = passwordEncoder;
        this.frontendBaseUrl = frontendBaseUrl;
    }

    @Transactional
    public void requestReset(String email, String requestedIp) {
        if (email == null || email.isBlank()) {
            return;
        }
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        Optional<User> found = userRepository.findByEmail(normalized);
        if (found.isEmpty()) {
            log.info("비밀번호 재설정 요청 - 미존재 계정 (응답은 동일하게 나간다)");
            return;
        }

        User user = found.get();
        if (!PROVIDER_LOCAL.equalsIgnoreCase(user.getProvider())) {
            asyncMailDispatcher.sendAfterCommit(
                user.getEmail(),
                "[Work-Flow] 비밀번호 재설정 안내",
                user.getName() + "님,\n\n"
                    + "이 계정은 Google 계정으로 가입되어 별도의 비밀번호가 없습니다.\n"
                    + "로그인 화면에서 'Google로 계속하기'를 이용해 주세요.\n\n"
                    + frontendBaseUrl + "/login\n"
            );
            return;
        }

        String rawToken = generateRawToken();
        tokenRepository.save(new PasswordResetToken(
            user.getId(),
            sha256Hex(rawToken),
            LocalDateTime.now().plusMinutes(TOKEN_TTL_MINUTES),
            requestedIp
        ));

        asyncMailDispatcher.sendAfterCommit(
            user.getEmail(),
            "[Work-Flow] 비밀번호 재설정",
            user.getName() + "님,\n\n"
                + "아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 "
                + TOKEN_TTL_MINUTES + "분 후 만료됩니다.\n\n"
                + frontendBaseUrl + "/reset-password?token=" + rawToken + "\n\n"
                + "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.\n"
        );
    }

    @Transactional
    public void confirmReset(String rawToken, String newPassword) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new InvalidResetTokenException("재설정 링크가 올바르지 않습니다.");
        }
        PasswordResetToken token = tokenRepository.findByTokenHash(sha256Hex(rawToken))
            .orElseThrow(() -> new InvalidResetTokenException(
                "재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요."));

        if (!token.isUsable(LocalDateTime.now())) {
            throw new InvalidResetTokenException(
                "재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.");
        }

        // 정책 위반은 토큰을 소모하기 전에 막는다. 오타 한 번에 메일을 다시 받게 하지 않는다.
        // 상한을 글자 수로 재던 시절엔 한글 25자가 여기를 빠져나가 아래 encode()에서 터졌고,
        // 그때는 이미 토큰이 소모된 뒤라 이 약속이 바이트 위반에서만 깨져 있었다.
        PasswordPolicy.validateNewPassword(newPassword);

        // isUsable 확인과 실제 소비 사이에 동시에 같은 토큰이 들어오면 둘 다 통과할 수 있다.
        // DB 조건부 갱신으로 그 틈을 닫는다 — 늦게 도착한 쪽은 0을 받고, 이는 뒤늦게 도착한 것과
        // 구분할 수 없으므로 동일하게 처리한다.
        if (tokenRepository.consumeIfUnused(token.getId()) == 0) {
            throw new InvalidResetTokenException(
                "재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.");
        }

        User user = userRepository.findById(token.getUserId())
            .orElseThrow(() -> new InvalidResetTokenException(
                "재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요."));

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        // 리프레시 토큰 무효화(AuthService.refresh) 판단 기준. 여기서 세팅해야 이전에 발급된
        // 리프레시 토큰이 이 시각 이후로는 거부된다.
        user.setPasswordChangedAt(LocalDateTime.now());
        // saveAndFlush: 아래 invalidateAllUnusedByUserId가 clearAutomatically=true라 영속성
        // 컨텍스트를 비운다. 그 전에 이 변경을 먼저 DB에 흘려보내지 않으면 커밋 없이 사라진다.
        userRepository.saveAndFlush(user);

        // 재설정에 성공한 시점에 유효한 다른 토큰이 남아 있으면 안 된다.
        tokenRepository.invalidateAllUnusedByUserId(user.getId());
        log.info("비밀번호 재설정 완료: userId={}", user.getId());
    }

    private String generateRawToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String sha256Hex(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256을 사용할 수 없다", e);
        }
    }
}
