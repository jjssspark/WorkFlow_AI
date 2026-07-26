-- ============================================================================
-- 관리자(is_admin) + 심사자 승인 거부 사유. additive/idempotent.
-- 최초 관리자는 운영자가 DB에서 직접 지정한다:
--   UPDATE users SET is_admin = true WHERE email = '...';
-- ============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS faculty_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS reviewer_rejection_reason VARCHAR(500);

COMMENT ON COLUMN users.is_admin IS '전역 관리자 여부. 최초 관리자는 운영자가 DB에서 직접 UPDATE로 지정한다.';
COMMENT ON COLUMN users.faculty_id IS '심사자(REVIEWER) 신청 시 입력하는 교수/교직원 식별번호. 민감정보 — 본인/관리자만 조회, 일반 응답에는 포함하지 않는다.';
COMMENT ON COLUMN users.reviewer_rejection_reason IS '관리자가 심사자 신청을 거부할 때 남기는 사유.';
COMMENT ON COLUMN users.reviewer_status IS 'REVIEWER로 가입 신청한 계정만 사용: PENDING(승인 대기)/APPROVED(승인 완료)/REJECTED(거부, 재신청 전까지 로그인 차단). NULL이면 심사자 신청 이력 없음.';
