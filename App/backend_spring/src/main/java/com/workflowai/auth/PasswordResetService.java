package com.workflowai.auth;

import com.workflowai.common.mail.MailSender;
import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
    private final MailSender mailSender;
    private final String frontendBaseUrl;
    private final SecureRandom secureRandom = new SecureRandom();

    public PasswordResetService(
        UserRepository userRepository,
        PasswordResetTokenRepository tokenRepository,
        MailSender mailSender,
        @Value("${workflow.frontend.base-url}") String frontendBaseUrl
    ) {
        this.userRepository = userRepository;
        this.tokenRepository = tokenRepository;
        this.mailSender = mailSender;
        this.frontendBaseUrl = frontendBaseUrl;
    }

    @Transactional
    public void requestReset(String email, String requestedIp) {
        if (email == null || email.isBlank()) {
            return;
        }
        String normalized = email.trim().toLowerCase();
        Optional<User> found = userRepository.findByEmail(normalized);
        if (found.isEmpty()) {
            log.info("비밀번호 재설정 요청 - 미존재 계정 (응답은 동일하게 나간다)");
            return;
        }

        User user = found.get();
        if (!PROVIDER_LOCAL.equalsIgnoreCase(user.getProvider())) {
            mailSender.send(
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

        boolean sent = mailSender.send(
            user.getEmail(),
            "[Work-Flow] 비밀번호 재설정",
            user.getName() + "님,\n\n"
                + "아래 링크에서 새 비밀번호를 설정해 주세요. 링크는 "
                + TOKEN_TTL_MINUTES + "분 후 만료됩니다.\n\n"
                + frontendBaseUrl + "/reset-password?token=" + rawToken + "\n\n"
                + "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.\n"
        );
        if (!sent) {
            // 여기서 예외를 던지면 500이 나가고, 그 500이 곧 "이 계정은 존재한다"는 신호가 된다.
            log.error("비밀번호 재설정 메일 발송 실패: userId={}", user.getId());
        }
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
