-- ============================================================================
-- 마일스톤 시작일(milestones.start_date), 업무 완료일(tasks.done_date) 컬럼.
-- additive/idempotent. 기존에 떠 있는 DB에는 수동으로 psql -f 실행 필요
-- (docker-entrypoint-initdb.d는 볼륨이 비어있을 때만 자동 실행됨).
--
-- tasks.done_date는 상태 전이 시점(Task.applyStatusChange)부터 자동으로 채워지므로,
-- 이 스크립트를 적용하기 전에 이미 status='done'이었던 기존 업무는 done_date가 NULL로
-- 남는다. 완료 통계(DashProgressPage/ProgressPage의 완료 업무 집계)에서 그 업무들이
-- 누락되지 않도록 updated_at을 완료 시점의 근사값으로 backfill한다.
-- ============================================================================

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_date DATE;

UPDATE tasks
SET done_date = updated_at::date
WHERE status = 'done' AND done_date IS NULL;
