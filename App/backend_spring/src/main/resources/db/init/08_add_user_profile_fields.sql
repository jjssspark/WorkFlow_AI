-- 컬럼명은 운영 Supabase에 이미 적용되어 있는 실제 스키마(field_tags/profile_image_path)를 그대로 따른다.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS affiliation VARCHAR(100),
    ADD COLUMN IF NOT EXISTS field_tags JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS github_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS profile_image_path VARCHAR(255);

COMMENT ON COLUMN users.affiliation IS '소속 (예: 컴퓨터공학과 3학년)';
COMMENT ON COLUMN users.field_tags IS '전공/관심 분야 태그 배열 (예: ["백엔드", "인프라"])';
COMMENT ON COLUMN users.github_username IS 'GitHub 아이디만 저장한다 (URL 아님)';
COMMENT ON COLUMN users.profile_image_path IS 'Supabase Storage 내 프로필 사진 오브젝트 경로 (avatars/{userId}/...)';
