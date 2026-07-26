-- Existing deployments do not re-run docker-entrypoint-initdb.d scripts.
-- Keep these changes additive/idempotent so Flyway can apply them before JPA validation.
--
-- 기본값은 Project 엔티티의 EvalStatus.PENDING과 맞춘다. CHECK 제약은 EvalStatus enum의
-- 4개 값(PENDING/EVALUATING/DONE/PUBLISHED)을 모두 허용한다 — dev 브랜치의
-- V20260724_2__project_eval_status.sql이 도입한 DONE 상태를 여기서도 반영한다.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS eval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_projects_eval_status'
    ) THEN
        ALTER TABLE projects ADD CONSTRAINT chk_projects_eval_status
            CHECK (eval_status IN ('PENDING', 'EVALUATING', 'DONE', 'PUBLISHED'));
    END IF;
END $$;
