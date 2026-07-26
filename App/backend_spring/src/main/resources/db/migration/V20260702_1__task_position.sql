-- 칸반 카드의 컬럼(status) 내 순서를 저장하기 위한 position 컬럼 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 정렬 규칙: 같은 status 안에서 position 오름차순. status가 다르면 값이 겹쳐도 무방
--           (프론트가 항상 status로 먼저 필터링한 뒤 렌더링하므로 컬럼 간 값은 서로 비교되지 않음).
-- 초기값 배정: 지금 화면에 보이는 순서(같은 project_id+status 안에서 created_at DESC, 기존 GET 정렬과 동일)를
--            그대로 유지하도록 0, 1, 2...를 배정한다. 이후부터는 드래그로 자유롭게 재배치 가능.

-- 1) 컬럼 추가 (일단 NULL 허용 - 백필 전이라 NOT NULL을 바로 걸 수 없음)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION;

-- 2) 기존 업무에 초기 position 배정
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY project_id, status ORDER BY created_at DESC) - 1 AS rn
  FROM tasks
)
UPDATE tasks
SET position = ranked.rn
FROM ranked
WHERE tasks.id = ranked.id;

-- 3) 백필 완료 후 NOT NULL 제약 추가
ALTER TABLE tasks ALTER COLUMN position SET NOT NULL;
