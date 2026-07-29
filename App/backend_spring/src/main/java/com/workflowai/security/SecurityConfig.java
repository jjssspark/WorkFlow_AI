package com.workflowai.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workflowai.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfigurationSource;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {
    private final JwtService jwtService;
    private final ObjectMapper objectMapper;
    private final CorsConfigurationSource corsConfigurationSource;

    public SecurityConfig(JwtService jwtService, ObjectMapper objectMapper, CorsConfigurationSource corsConfigurationSource) {
        this.jwtService = jwtService;
        this.objectMapper = objectMapper;
        this.corsConfigurationSource = corsConfigurationSource;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfigurationSource))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers("/api/v1/health", "/api/v1/health/**").permitAll()
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()
                // 컨트롤러에서 예외가 나면 서블릿 컨테이너가 인증 헤더 없이 /error로 내부 forward한다.
                // /error가 permitAll이 아니면 이 forward 자체가 인증 필요 요청으로 막혀 진짜 에러(예:
                // 500) 대신 401만 나가서 원인이 완전히 가려진다.
                .requestMatchers("/error").permitAll()
                .anyRequest().authenticated()
            )
            .exceptionHandling(handling -> handling
                .authenticationEntryPoint(this::handleUnauthorized)
                .accessDeniedHandler(this::handleForbidden)
            )
            .addFilterBefore(new JwtAuthenticationFilter(jwtService), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private void handleUnauthorized(
        HttpServletRequest request,
        HttpServletResponse response,
        AuthenticationException ex
    ) throws IOException {
        writeError(response, 401, "UNAUTHORIZED", "로그인이 필요합니다.");
    }

    private void handleForbidden(
        HttpServletRequest request,
        HttpServletResponse response,
        AccessDeniedException ex
    ) throws IOException {
        writeError(response, 403, "FORBIDDEN", "권한이 없습니다.");
    }

    private void writeError(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.fail(code, message)));
    }
}
