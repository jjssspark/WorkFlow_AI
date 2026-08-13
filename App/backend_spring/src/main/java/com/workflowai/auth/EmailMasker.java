package com.workflowai.auth;

/** 아이디 찾기 결과에서 이메일 유출 폭을 제한한다. 로컬 파트 앞 2자만 남긴다. */
final class EmailMasker {
    private static final String FULLY_MASKED = "****";
    private static final int VISIBLE_PREFIX = 2;

    private EmailMasker() {
    }

    static String mask(String email) {
        if (email == null || email.isBlank()) {
            return "";
        }
        int at = email.indexOf('@');
        if (at <= 0) {
            return FULLY_MASKED;
        }
        String local = email.substring(0, at);
        String domain = email.substring(at);
        int visible = local.length() <= VISIBLE_PREFIX ? 1 : VISIBLE_PREFIX;
        if (local.length() <= visible) {
            return local + domain;
        }
        return local.substring(0, visible) + "*".repeat(local.length() - visible) + domain;
    }
}
