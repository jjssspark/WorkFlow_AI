package com.workflowai.security;

import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component("adminAccess")
public class AdminAccess {
    private final UserRepository userRepository;

    public AdminAccess(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public boolean isAdmin() {
        Long userId = currentUserId();
        if (userId == null) {
            return false;
        }
        return userRepository.findById(userId).map(User::isAdmin).orElse(false);
    }

    private Long currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof UserPrincipal principal) {
            return principal.id();
        }
        return null;
    }
}
