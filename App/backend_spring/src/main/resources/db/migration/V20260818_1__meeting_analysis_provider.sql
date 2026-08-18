-- ============================================================================
-- 요약을 실제로 만든 분석 티어. analysis_engine(FASTAPI / SPRING_FALLBACK)만으로는
-- FastAPI 안에서 huggingface -> ollama -> 규칙 기반으로 강등된 것을 알 수 없어,
-- 저장된 분석을 다시 열면 사용자가 받은 요약의 출처를 알 방법이 없었다.
--
-- 기존 행은 NULL로 둔다. 그 시점의 티어를 알 방법이 없어 backfill하면 모르는 값을
-- 아는 척하게 된다. 읽는 쪽에서 NULL은 unknown으로 넘긴다.
-- ============================================================================

ALTER TABLE meeting_analysis ADD COLUMN IF NOT EXISTS analysis_provider VARCHAR(64);

COMMENT ON COLUMN meeting_analysis.analysis_provider IS 'FastAPI 안에서 실제로 답한 분석 티어 (huggingface / ollama / rule_based / spring_fallback). NULL이면 이 컬럼이 생기기 전에 저장된 분석이라 출처를 모른다.';
