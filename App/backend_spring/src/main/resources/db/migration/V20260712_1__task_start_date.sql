ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS start_date DATE;

COMMENT ON COLUMN public.tasks.start_date
    IS '업무 시작일 (선택, 마감일보다 뒤일 수 없음)';
