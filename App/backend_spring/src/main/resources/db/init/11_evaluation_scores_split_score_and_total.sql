-- ============================================================================
-- 버그 수정: evaluation_scores.score 컬럼이 "AI가 산정한 기여 점수"와
-- "학점 계산기가 계산한 최종 총합"을 동시에 저장하는 데 쓰이고 있었다.
-- total_score 컬럼을 신설해 두 값을 분리한다.
-- 기존에 떠 있는 DB에는 수동으로 psql -f 실행 필요
-- (docker-entrypoint-initdb.d는 볼륨이 비어있을 때만 자동 실행됨).
-- ============================================================================

ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS total_score DECIMAL(5,2);

UPDATE evaluation_scores SET total_score = score WHERE reviewer_score IS NOT NULL AND total_score IS NULL;

COMMENT ON COLUMN evaluation_scores.score IS 'AI가 산정한 기여 점수(기여도 분석 화면 왼쪽 테이블 값)';
COMMENT ON COLUMN evaluation_scores.total_score IS '학점 계산기가 계산해 저장한 최종 총합(기여 점수×비율 + 심사자 점수×비율)';
