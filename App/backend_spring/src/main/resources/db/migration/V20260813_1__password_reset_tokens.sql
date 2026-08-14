-- 비밀번호 재설정 토큰. 원문은 저장하지 않고 SHA-256 해시(hex 64자)만 보관한다.
-- 토큰을 가진 사람은 비밀번호를 바꿀 수 있으므로 토큰은 비밀번호와 동등하게 취급한다.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    VARCHAR(64)  NOT NULL UNIQUE,
    expires_at    TIMESTAMP    NOT NULL,
    used_at       TIMESTAMP,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    requested_ip  VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
    ON password_reset_tokens (user_id);
