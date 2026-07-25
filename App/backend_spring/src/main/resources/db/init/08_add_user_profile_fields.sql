-- 컬럼명은 운영 Supabase에 이미 적용되어 있는 실제 스키마(field_tags/profile_image_path)를 그대로 따른다.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS affiliation VARCHAR(100),
    ADD COLUMN IF NOT EXISTS field_tags JSONB,
    ADD COLUMN IF NOT EXISTS github_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS profile_image_path VARCHAR(255);

-- field_tags를 곧바로 NOT NULL로 선언하면(운영처럼 이미 데이터가 있는 테이블에서) 기존 행의 NULL 값과
-- 충돌해 마이그레이션이 실패할 수 있다. nullable로 컬럼을 만들고 -> 기존 NULL 값을 백필 -> 그 다음에야
-- NOT NULL 제약을 건다. 세 단계 다 IF NOT EXISTS/WHERE 조건으로 재실행해도 안전하다.
UPDATE users SET field_tags = '[]'::jsonb WHERE field_tags IS NULL;
ALTER TABLE users ALTER COLUMN field_tags SET DEFAULT '[]'::jsonb;
ALTER TABLE users ALTER COLUMN field_tags SET NOT NULL;

COMMENT ON COLUMN users.affiliation IS '소속 (예: 컴퓨터공학과 3학년)';
COMMENT ON COLUMN users.field_tags IS '전공/관심 분야 태그 배열 (예: ["백엔드", "인프라"])';
COMMENT ON COLUMN users.github_username IS 'GitHub 아이디만 저장한다 (URL 아님)';
COMMENT ON COLUMN users.profile_image_path IS 'Supabase Storage 내 프로필 사진 오브젝트 경로 (avatars/{userId}/...)';
