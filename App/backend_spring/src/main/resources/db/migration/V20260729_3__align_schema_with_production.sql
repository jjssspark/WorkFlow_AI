-- ============================================================================
-- 빈 DB로 만든 스키마를 운영 Supabase의 실제 상태에 맞춘다.
--
-- 아래 4건은 운영에는 이미 반영돼 있으나 V파일에는 없거나 다르게 정의돼 있어,
-- 새 환경을 띄우면 운영과 다른 DB가 만들어지던 항목이다. 운영을 기준으로 삼는다.
-- 운영에서는 전부 no-op이고, 빈 DB에서만 실제로 바뀐다.
--
-- 근거: docs/trouble-shooting/2026-07-29-supabase-schema-drift.md
-- ============================================================================

-- 1) eval_status 기본값. V20260724_2는 'PENDING'으로 넣었으나 운영은 'EVALUATING'이다.
--    Project.evalStatus가 PENDING으로 초기화돼 JPA가 INSERT마다 값을 명시하므로
--    기본값에 의존하는 경로는 없다.
ALTER TABLE projects ALTER COLUMN eval_status SET DEFAULT 'EVALUATING';

-- 2) eval_status CHECK 제약. V20260723_2/V20260724_6이 IF NOT EXISTS 가드라
--    이미 3값 제약이 있던 운영은 갱신을 건너뛰었고, 빈 DB만 DONE을 포함한 4값이 됐다.
--    운영 기준인 3값으로 통일한다.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_eval_status;
ALTER TABLE projects ADD CONSTRAINT chk_projects_eval_status
    CHECK (eval_status IN ('PENDING', 'EVALUATING', 'PUBLISHED'));

COMMENT ON COLUMN projects.eval_status IS '심사자 평가 상태: PENDING/EVALUATING/PUBLISHED (chk_projects_eval_status로 제한)';

-- 3) tasks.position 기본값. 운영에는 없다. Task.position이 primitive double이라
--    JPA가 항상 값을 쓰므로 기본값에 의존하는 경로는 없다.
ALTER TABLE tasks ALTER COLUMN position DROP DEFAULT;

-- 4) tasks.move_version. 운영에만 있고 레포 어디에도 정의가 없던 컬럼.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS move_version BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN tasks.move_version IS '출처 불명. 운영에만 있던 컬럼을 정합화 목적으로 편입했다. 앱 코드에서 참조하지 않음';
