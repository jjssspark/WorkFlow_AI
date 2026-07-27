-- ============================================================================
-- 학점 계산기 드롭다운에 "A/B/C/D"(A0 대신 A만 쓰는 학교) 계열 추가.
-- CHECK 제약을 교체해야 하므로 idempotent하게 기존 제약을 지우고 다시 만든다.
-- 기존에 떠 있는 DB에는 수동으로 psql -f 실행 필요
-- (docker-entrypoint-initdb.d는 볼륨이 비어있을 때만 자동 실행됨).
-- ============================================================================

ALTER TABLE evaluation_scores DROP CONSTRAINT IF EXISTS chk_evaluation_scores_grade;

ALTER TABLE evaluation_scores ADD CONSTRAINT chk_evaluation_scores_grade
    CHECK (grade IS NULL OR grade IN (
        'A+', 'A', 'A0', 'A-', 'B+', 'B', 'B0', 'B-', 'C+', 'C', 'C0', 'C-',
        'D+', 'D', 'D0', 'D-', 'F', 'P', 'NP'
    ));

COMMENT ON COLUMN evaluation_scores.grade IS '학점(A+/A/A0/A-/B+/B/B0/B-/C+/C/C0/C-/D+/D/D0/D-/F/P/NP)';
