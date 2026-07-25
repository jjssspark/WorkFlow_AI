ALTER TABLE users
    ADD COLUMN IF NOT EXISTS terms_agreed_at TIMESTAMP;

COMMENT ON COLUMN users.terms_agreed_at IS '이메일/비밀번호 회원가입 시 이용약관에 동의한 시각. Google OAuth/데모 계정은 이 절차를 거치지 않아 NULL';
