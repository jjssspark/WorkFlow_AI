-- ============================================================================
-- 비밀번호 변경 시각. 리프레시 토큰 무효화 판단에 쓴다 (iat <= password_changed_at이면 거부).
-- NULL은 "비밀번호를 바꾼 적이 없다"는 뜻이라 기존 유저에 backfill하지 않는다 — backfill하면
-- 그 시점 이전에 발급된 모든 리프레시 토큰이 한꺼번에 무효화되어 전체 서비스가 로그아웃된다.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;

COMMENT ON COLUMN users.password_changed_at IS '비밀번호를 실제로 바꾼 시각 (재설정 확인 시에만 세팅). NULL이면 비밀번호를 바꾼 적이 없어 리프레시 토큰을 무효화하지 않는다.';
