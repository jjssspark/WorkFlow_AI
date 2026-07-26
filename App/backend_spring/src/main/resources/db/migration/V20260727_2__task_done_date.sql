-- ============================================================================
-- 업무 완료일(tasks.done_date). additive/idempotent.
-- milestones.start_date는 V20260722_1__roadmap_planning_dates.sql에서 이미 반영됨 -
-- 이 마이그레이션은 그때 함께 추가되지 못했던 tasks.done_date만 보충한다.
--
-- done_date는 상태 전이 시점(Task.applyStatusChange)부터 애플리케이션이 자동으로
-- 채우므로, 이 마이그레이션 적용 이전에 이미 status='done'이었던 기존 업무는
-- done_date가 NULL로 남는다. 완료 통계(DashProgressPage/ProgressPage의 완료 업무
-- 집계)에서 그 업무들이 누락되지 않도록 updated_at을 완료 시점의 근사값으로 backfill한다.
-- ============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_date DATE;

UPDATE tasks
SET done_date = updated_at::date
WHERE status = 'done' AND done_date IS NULL;
