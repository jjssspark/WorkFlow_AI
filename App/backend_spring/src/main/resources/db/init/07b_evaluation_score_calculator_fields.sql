-- ============================================================================
-- 기여도 분석 화면의 "학점 계산기" 지원 컬럼/테이블. additive/idempotent.
-- 기존에 떠 있는 DB에는 수동으로 psql -f 실행 필요
-- (docker-entrypoint-initdb.d는 볼륨이 비어있을 때만 자동 실행됨).
-- ============================================================================

ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS reviewer_score DECIMAL(5,2);
ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS grade VARCHAR(2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_evaluation_scores_grade'
    ) THEN
        ALTER TABLE evaluation_scores ADD CONSTRAINT chk_evaluation_scores_grade
            CHECK (grade IS NULL OR grade IN (
                'A+', 'A0', 'A-', 'B+', 'B0', 'B-', 'C+', 'C0', 'C-',
                'D+', 'D0', 'D-', 'F', 'P', 'NP'
            ));
    END IF;
END $$;

COMMENT ON COLUMN evaluation_scores.reviewer_score IS '심사자가 학점 계산기에서 직접 입력한 심사자 점수(0~100)';
COMMENT ON COLUMN evaluation_scores.grade IS '학점(A+/A0/A-/B+/B0/B-/C+/C0/C-/D+/D0/D-/F/P/NP)';

CREATE TABLE IF NOT EXISTS evaluation_settings (
    project_id         BIGINT PRIMARY KEY,
    contribution_ratio DECIMAL(5,2) NOT NULL DEFAULT 40.00,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_eval_settings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE evaluation_settings IS '프로젝트별 학점 계산기 점수 비율 설정';
COMMENT ON COLUMN evaluation_settings.contribution_ratio IS '기여 점수 반영 비율(%, 0~100). 심사자 점수 비율은 100에서 뺀 값으로 자동 계산';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_evaluation_settings_updated_at'
    ) THEN
        CREATE TRIGGER trg_evaluation_settings_updated_at
            BEFORE UPDATE ON evaluation_settings
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;
