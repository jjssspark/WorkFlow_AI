package com.workflowai.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

@ExtendWith(MockitoExtension.class)
class AdminAccessTest {

    @Mock
    private UserRepository userRepository;

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void isAdminReturnsTrueForAdminUser() {
        AdminAccess adminAccess = new AdminAccess(userRepository);
        authenticate(1L);
        User admin = new User("admin@example.com", "관리자", "local", "admin@example.com");
        admin.setAdmin(true);
        when(userRepository.findById(1L)).thenReturn(Optional.of(admin));

        assertThat(adminAccess.isAdmin()).isTrue();
    }

    @Test
    void isAdminReturnsFalseForNonAdminUser() {
        AdminAccess adminAccess = new AdminAccess(userRepository);
        authenticate(2L);
        User member = new User("member@example.com", "회원", "local", "member@example.com");
        when(userRepository.findById(2L)).thenReturn(Optional.of(member));

        assertThat(adminAccess.isAdmin()).isFalse();
    }

    @Test
    void isAdminReturnsFalseWhenNoAuthentication() {
        AdminAccess adminAccess = new AdminAccess(userRepository);

        assertThat(adminAccess.isAdmin()).isFalse();
    }

    @Test
    void isAdminReturnsFalseWhenUserNotFound() {
        AdminAccess adminAccess = new AdminAccess(userRepository);
        authenticate(3L);
        when(userRepository.findById(3L)).thenReturn(Optional.empty());

        assertThat(adminAccess.isAdmin()).isFalse();
    }

    private void authenticate(Long userId) {
        UserPrincipal principal = new UserPrincipal(userId, "user@example.com", "사용자");
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken(principal, null));
    }
}
