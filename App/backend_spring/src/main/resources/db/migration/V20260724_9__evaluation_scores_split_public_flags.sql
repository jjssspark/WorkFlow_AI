-- Existing deployments do not re-run docker-entrypoint-initdb.d scripts.
-- Keep these changes additive/idempotent so Flyway can apply them before JPA validation.
--
-- 기존 is_public 하나로 기여 점수/총합·학점/심사 코멘트가 한꺼번에 공개되던 것을
-- 세 개의 독립 플래그로 분리한다. 기존 is_public=true였던 row는 컬럼명 변경만으로
-- contribution_public=true를 그대로 유지하고, final_public/comment_public은
-- 새 컬럼이라 기본값(false)으로 시작한다(과다 공개 방지 — 안전한 기본값).
--
-- RENAME은 is_public 컬럼이 실제로 존재할 때만 실행한다 — Flyway가 신규 DB
-- 구성(docker-entrypoint-initdb.d의 init 스크립트들이 먼저 전부 실행되는 경우)에서
-- 켜져 있으면, init/10_evaluation_scores_split_public_flags.sql이 이미
-- is_public을 contribution_public으로 바꿔둔 뒤 이 마이그레이션이 실행되어
-- RENAME 대상 컬럼이 없어 실패하는 문제를 방지한다(코드 리뷰로 발견).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'evaluation_scores' AND column_name = 'is_public'
    ) THEN
        ALTER TABLE evaluation_scores RENAME COLUMN is_public TO contribution_public;
    END IF;
END $$;

ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS final_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS comment_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS comment TEXT;

COMMENT ON COLUMN evaluation_scores.contribution_public IS '기여 점수(왼쪽 기여도 테이블) 공개 여부';
COMMENT ON COLUMN evaluation_scores.final_public IS '학점 계산기 총합/심사자 점수/학점 공개 여부';
COMMENT ON COLUMN evaluation_scores.comment_public IS '심사 코멘트 공개 여부';
COMMENT ON COLUMN evaluation_scores.comment IS '심사자가 팀원에게 남기는 평가 코멘트';
