package com.workflowai.auth;

import java.nio.charset.StandardCharsets;

/**
 * 비밀번호 길이 정책. 가입·변경·재설정 세 곳이 같은 규칙을 써야 해서 한곳에 모았다.
 *
 * <p>상한이 글자 수가 아니라 UTF-8 바이트인 이유: BCryptPasswordEncoder.encode()는 72바이트를 넘는
 * 입력을 자르지 않고 IllegalArgumentException("password cannot be more than 72 bytes")을 던진다.
 * 글자 수로 세면 한글 25자(75바이트)가 정책을 통과해 encode()에서 터지고, 사용자에게는 입력 오류가
 * 아니라 500으로 보인다.
 *
 * <p>글자 수 상한을 함께 두지 않는 이유: 두 기준이 공존하면 129자를 넣은 사용자에게 "128자 이하"라고
 * 안내했다가, 100자로 줄여 오면 그제서야 "72바이트"라고 말하게 된다. 기준은 하나여야 한다.
 */
final class PasswordPolicy {

    static final int MIN_LENGTH = 8;
    static final int MAX_BYTES = 72;

    private PasswordPolicy() {
    }

    /**
     * 새로 저장될 비밀번호를 검사한다. 저장 전에 호출해야 한다 — 재설정처럼 부수효과(토큰 소모)가
     * 앞서는 흐름에서는 그 부수효과보다도 먼저 불러야 사용자가 링크를 잃지 않는다.
     *
     * @throws InvalidSignupInputException 정책을 어겼을 때
     */
    static void validateNewPassword(String password) {
        if (password == null || password.length() < MIN_LENGTH) {
            throw new InvalidSignupInputException("비밀번호는 " + MIN_LENGTH + "자 이상으로 입력해주세요.");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new InvalidSignupInputException(
                "비밀번호가 너무 깁니다. 영문·숫자는 " + MAX_BYTES + "자, 한글은 " + (MAX_BYTES / 3) + "자까지 쓸 수 있습니다.");
        }
    }
}
