ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS pending_approval BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tasks.pending_approval
    IS '팀원이 완료 이동을 요청했고 아직 팀장 승인/반려 전인 상태';
