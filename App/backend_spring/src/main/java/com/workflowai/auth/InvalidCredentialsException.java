package com.workflowai.auth;

/** 실제 계정(이메일/비밀번호) 로그인 시 이메일이 없거나 비밀번호가 틀렸을 때 던진다. */
public class InvalidCredentialsException extends RuntimeException {
    public InvalidCredentialsException() {
        super("이메일 또는 비밀번호가 올바르지 않습니다.");
    }

    /** 이메일 입력란이 없는 화면(예: 로그인 후 비밀번호 변경)에서 쓸 문구를 따로 줄 때. */
    public InvalidCredentialsException(String message) {
        super(message);
    }
}
