ALTER TABLE users
    ADD COLUMN IF NOT EXISTS privacy_agreed_at TIMESTAMP;

COMMENT ON COLUMN users.privacy_agreed_at IS '이메일/비밀번호 회원가입 시 개인정보처리방침에 동의한 시각. terms_agreed_at과 별도로 기록한다. Google OAuth/데모 계정은 이 절차를 거치지 않아 NULL';
