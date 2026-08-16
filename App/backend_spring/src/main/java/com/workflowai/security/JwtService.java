package com.workflowai.security;

import com.workflowai.user.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private static final String CLAIM_TYPE = "typ";
    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";

    private final JwtProperties properties;
    private final SecretKey key;

    public JwtService(JwtProperties properties) {
        this.properties = properties;
        this.key = Keys.hmacShaKeyFor(properties.secret().getBytes(StandardCharsets.UTF_8));
    }

    public String issueAccessToken(User user) {
        return issueToken(user, TYPE_ACCESS, properties.accessTokenTtlSeconds(), Instant.now());
    }

    public String issueRefreshToken(User user) {
        return issueRefreshToken(user, Instant.now());
    }

    /**
     * 발급 시각을 호출자가 정하는 리프레시 토큰. 비밀번호 변경처럼 "이 시각 이전에 발급된 토큰은
     * 거부한다"는 경계를 스스로 세우는 흐름에서, 방금 만든 토큰이 그 경계에 걸리지 않도록
     * iat을 경계 밖으로 밀어내는 데 쓴다. 그 외에는 {@link #issueRefreshToken(User)}를 쓴다.
     */
    public String issueRefreshToken(User user, Instant issuedAt) {
        return issueToken(user, TYPE_REFRESH, properties.refreshTokenTtlSeconds(), issuedAt);
    }

    public long accessTokenTtlSeconds() {
        return properties.accessTokenTtlSeconds();
    }

    public Claims parseAccessToken(String token) {
        Claims claims = parse(token);
        requireType(claims, TYPE_ACCESS);
        return claims;
    }

    public Claims parseRefreshToken(String token) {
        Claims claims = parse(token);
        requireType(claims, TYPE_REFRESH);
        return claims;
    }

    private String issueToken(User user, String type, long ttlSeconds, Instant issuedAt) {
        return Jwts.builder()
            .subject(String.valueOf(user.getId()))
            .claim(CLAIM_TYPE, type)
            .claim("email", user.getEmail())
            .claim("name", user.getName())
            .issuedAt(Date.from(issuedAt))
            .expiration(Date.from(issuedAt.plusSeconds(ttlSeconds)))
            .signWith(key)
            .compact();
    }

    private Claims parse(String token) {
        try {
            return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            throw new InvalidTokenException("유효하지 않은 토큰입니다.", e);
        }
    }

    private void requireType(Claims claims, String expected) {
        if (!expected.equals(claims.get(CLAIM_TYPE, String.class))) {
            throw new InvalidTokenException("토큰 타입이 올바르지 않습니다.");
        }
    }
}
