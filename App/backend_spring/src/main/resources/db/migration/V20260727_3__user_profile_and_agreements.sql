-- ============================================================================
-- 사용자 프로필 및 필수 동의 이력.
--
-- 이 컬럼들은 기존에는 docker-entrypoint-initdb.d의 db/init에만 있어, 이미 생성된
-- 운영 DB에는 init 스크립트가 재실행되지 않았다. 운영 baseline(20260721.1)보다 높은
-- 신규 V파일에서 보장해 애플리케이션 배포 전에 Flyway가 누락 컬럼을 추가하도록 한다.
-- ============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS affiliation VARCHAR(100),
    ADD COLUMN IF NOT EXISTS github_username VARCHAR(100),
    ADD COLUMN IF NOT EXISTS profile_image_path VARCHAR(255),
    ADD COLUMN IF NOT EXISTS terms_agreed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS privacy_agreed_at TIMESTAMP;

-- field_tags가 처음 생기는 레거시 DB에는 과거 단일 field 값을 보존한다. 이미
-- field_tags가 있는 DB에서는 사용자가 비운 배열을 레거시 값으로 되살리지 않는다.
DO $$
DECLARE
    field_tags_existed BOOLEAN;
    legacy_field_type TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'field_tags'
    ) INTO field_tags_existed;

    IF NOT field_tags_existed THEN
        ALTER TABLE users ADD COLUMN field_tags JSONB;

        SELECT data_type
        INTO legacy_field_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'field';

        IF legacy_field_type = 'jsonb' THEN
            UPDATE users
            SET field_tags = field
            WHERE field IS NOT NULL AND field <> '[]'::jsonb;
        ELSIF legacy_field_type IS NOT NULL THEN
            UPDATE users
            SET field_tags = jsonb_build_array(field)
            WHERE field IS NOT NULL AND field <> '';
        END IF;
    END IF;
END $$;

UPDATE users SET field_tags = '[]'::jsonb WHERE field_tags IS NULL;
ALTER TABLE users ALTER COLUMN field_tags SET DEFAULT '[]'::jsonb;
ALTER TABLE users ALTER COLUMN field_tags SET NOT NULL;

COMMENT ON COLUMN users.affiliation IS '소속 (예: 컴퓨터공학과 3학년)';
COMMENT ON COLUMN users.field_tags IS '전공/관심 분야 태그 배열 (예: ["백엔드", "인프라"])';
COMMENT ON COLUMN users.github_username IS 'GitHub 아이디만 저장한다 (URL 아님)';
COMMENT ON COLUMN users.profile_image_path IS 'Supabase Storage 내 프로필 사진 오브젝트 경로 (avatars/{userId}/...)';
COMMENT ON COLUMN users.terms_agreed_at IS '이메일/비밀번호 회원가입 시 이용약관에 동의한 시각. Google OAuth/데모 계정은 NULL';
COMMENT ON COLUMN users.privacy_agreed_at IS '이메일/비밀번호 회원가입 시 개인정보처리방침에 동의한 시각. Google OAuth/데모 계정은 NULL';
