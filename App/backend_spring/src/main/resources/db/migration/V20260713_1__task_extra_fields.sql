ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS extra_fields JSONB;

COMMENT ON COLUMN public.tasks.extra_fields
    IS '카테고리별 추가 정보(자유 키-값). AddTaskModal/EditTaskModal의 카테고리 전용 입력값을 저장';
