ALTER TABLE public.meetings
    ADD COLUMN IF NOT EXISTS analysis_job_id UUID;

COMMENT ON COLUMN public.meetings.analysis_job_id
    IS '현재 Redis Stream 분석 작업의 세대 식별자';
