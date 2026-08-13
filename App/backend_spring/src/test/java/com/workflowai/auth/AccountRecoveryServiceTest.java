package com.workflowai.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AccountRecoveryServiceTest {

    @Mock
    private UserRepository userRepository;

    private AccountRecoveryService service;

    @BeforeEach
    void setUp() {
        service = new AccountRecoveryService(userRepository);
    }

    @Test
    @DisplayName("일치하는 계정의 이메일을 마스킹해서 돌려준다")
    void findMaskedEmails_match_returnsMasked() {
        when(userRepository.findAllByNameAndAffiliation(eq("홍길동"), eq("컴퓨터공학과")))
            .thenReturn(List.of(user("kimchulsoo@gmail.com")));

        assertThat(service.findMaskedEmails("홍길동", "컴퓨터공학과"))
            .containsExactly("ki********@gmail.com");
    }

    @Test
    @DisplayName("일치하는 계정이 없으면 예외가 아니라 빈 목록")
    void findMaskedEmails_noMatch_returnsEmpty() {
        when(userRepository.findAllByNameAndAffiliation(eq("없는사람"), eq("없는소속")))
            .thenReturn(List.of());

        assertThat(service.findMaskedEmails("없는사람", "없는소속")).isEmpty();
    }

    @Test
    @DisplayName("입력의 앞뒤 공백은 무시한다")
    void findMaskedEmails_trimsInput() {
        when(userRepository.findAllByNameAndAffiliation(eq("홍길동"), eq("컴퓨터공학과")))
            .thenReturn(List.of(user("abc@naver.com")));

        assertThat(service.findMaskedEmails("  홍길동 ", " 컴퓨터공학과  "))
            .containsExactly("ab*@naver.com");
    }

    private User user(String email) {
        return new User(email, "홍길동", "local", email, "hash");
    }
}
