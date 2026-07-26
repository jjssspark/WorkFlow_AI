-- Existing deployments do not re-run docker-entrypoint-initdb.d scripts.
-- Keep these changes additive/idempotent so Flyway can apply them before JPA validation.
--
-- 버그 수정: evaluation_scores.score 컬럼이 "AI가 산정한 기여 점수"와
-- "학점 계산기가 계산한 최종 총합"을 동시에 저장하는 데 쓰이고 있었다.
-- 학점 계산기에서 저장할 때마다 원래 score(기여 점수)가 total로 덮어써졌고,
-- contribution_public만 켜서 기여 점수만 공개하려 해도 마이페이지에는
-- (총합으로 덮어써진) score가 "기여 점수"인 것처럼 노출되는 결함이 있었다.
-- total_score 컬럼을 신설해 두 값을 분리한다. 기존에 score에 저장돼 있던 값은
-- 대부분 이미 학점 계산기의 총합으로 덮어써진 상태라 total_score로 그대로
-- 옮기고, score는 다음 "리포트 새로고침"(기여도 재계산) 시 실제 AI 기여
-- 점수로 다시 채워진다.

ALTER TABLE evaluation_scores ADD COLUMN IF NOT EXISTS total_score DECIMAL(5,2);

UPDATE evaluation_scores SET total_score = score WHERE reviewer_score IS NOT NULL AND total_score IS NULL;

COMMENT ON COLUMN evaluation_scores.score IS 'AI가 산정한 기여 점수(기여도 분석 화면 왼쪽 테이블 값)';
COMMENT ON COLUMN evaluation_scores.total_score IS '학점 계산기가 계산해 저장한 최종 총합(기여 점수×비율 + 심사자 점수×비율)';
