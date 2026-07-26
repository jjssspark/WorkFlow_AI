-- Existing deployments do not re-run docker-entrypoint-initdb.d scripts.
-- Keep these changes additive/idempotent so Flyway can apply them before JPA validation.

ALTER TABLE evaluation_scores DROP CONSTRAINT IF EXISTS chk_evaluation_scores_grade;

ALTER TABLE evaluation_scores ADD CONSTRAINT chk_evaluation_scores_grade
    CHECK (grade IS NULL OR grade IN (
        'A+', 'A', 'A0', 'A-', 'B+', 'B', 'B0', 'B-', 'C+', 'C', 'C0', 'C-',
        'D+', 'D', 'D0', 'D-', 'F', 'P', 'NP'
    ));
