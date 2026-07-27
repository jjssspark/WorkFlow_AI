-- ============================================================================
-- 기존 is_public 하나로 기여 점수/총합·학점/심사 코멘트가 한꺼번에 공개되던 것을
-- 세 개의 독립 플래그로 분리한다. 기존에 떠 있는 DB에는 수동으로 psql -f 실행 필요
-- (docker-entrypoint-initdb.d는 볼륨이 비어있을 때만 자동 실행됨).
-- ============================================================================

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
