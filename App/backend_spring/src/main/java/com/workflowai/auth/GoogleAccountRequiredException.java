package com.workflowai.auth;

/** 비밀번호 로그인 시도한 계정이 Google OAuth 전용(password_hash 없음)일 때 던진다. */
public class GoogleAccountRequiredException extends RuntimeException {
    public GoogleAccountRequiredException() {
        super("Google 계정으로 로그인해주세요.");
    }

    /** 이미 로그인한 사용자에게 "로그인해주세요"라고 말하면 안 되는 화면에서 쓸 문구를 따로 줄 때. */
    public GoogleAccountRequiredException(String message) {
        super(message);
    }
}
