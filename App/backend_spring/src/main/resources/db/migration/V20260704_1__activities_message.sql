-- activities 테이블에 사람이 읽을 수 있는 메시지를 저장할 컬럼 추가.
-- 적용 대상: 현재 Supabase PostgreSQL (추후 OCI 자체 호스팅 이전 시 동일 스크립트 재실행)
-- 전제: activities 테이블은 아직 어떤 백엔드 코드도 쓰지 않아 데이터가 없다(2026-07-16 확인) - 백필 불필요.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE activities ALTER COLUMN message DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_activities_target ON activities (target_id);
