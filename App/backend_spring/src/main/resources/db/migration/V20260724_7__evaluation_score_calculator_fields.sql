-- Existing deployments do not re-run docker-entrypoint-initdb.d scripts.
-- Keep these changes additive/idempotent so Flyway can apply them before JPA validation.

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

CREATE TABLE IF NOT EXISTS evaluation_settings (
    project_id         BIGINT PRIMARY KEY,
    contribution_ratio DECIMAL(5,2) NOT NULL DEFAULT 40.00,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_eval_settings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

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
