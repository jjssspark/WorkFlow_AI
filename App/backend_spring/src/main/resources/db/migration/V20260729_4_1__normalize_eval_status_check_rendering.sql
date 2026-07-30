-- ============================================================================
-- chk_projects_eval_status 의 정의 렌더링을 원본 형태로 되돌린다.
--
-- 무엇이 문제인가
--   이 제약은 의미가 같아도 두 가지 형태로 렌더링된다.
--     (A) CHECK (((eval_status)::text = ANY ((ARRAY['PENDING'::character varying,
--         'EVALUATING'::character varying, 'PUBLISHED'::character varying])::text[])))
--     (B) CHECK (((eval_status)::text = ANY (ARRAY[('PENDING'::character varying)::text,
--         ('EVALUATING'::character varying)::text, ('PUBLISHED'::character varying)::text])))
--   두 형태가 허용하는 값 집합은 완전히 동일하다. 차이는 캐스팅 위치뿐이다.
--
-- 왜 (B)가 됐나
--   2026-07-30 운영 DB를 Supabase에서 OCI 자체 호스팅으로 옮기면서 pg_dump/pg_restore를
--   썼다. pg_dump는 제약을 정의 "문자열"로 내보내는데, 그 문자열을 복원 측에서 다시
--   파싱하면 캐스팅 위치가 다른 표현식 트리가 만들어져 (B)로 저장된다. 즉 이건 스키마
--   드리프트가 아니라 이관 방식이 만들어낸 표기 차이다.
--
-- 왜 고쳐야 하나
--   바로 다음 V20260729_5가 제약 정의 문자열의 **완전 일치**를 요구한다. 그 기준값은
--   운영(Supabase)에서 뽑은 (A)다. 손대지 않으면 V20260729_5가 이 항목 하나 때문에
--   실패해 배포가 막힌다(2026-07-30 운영 DB 복제본에서 실측 확인).
--
-- 왜 V20260729_5의 기준값을 고치지 않았나
--   검증을 느슨하게 만들면 앞으로 진짜 드리프트도 놓친다. 그리고 이미 커밋된
--   마이그레이션 파일 수정은 CI 가드가 차단한다(2026-07-26 41분 중단에서 나온 규칙).
--   대신 DB를 원본 형태로 모아서 엄격한 검증이 계속 유효하게 둔다.
--
-- 왜 버전이 20260729.4.1 인가
--   V20260729_5보다 먼저 실행돼야 한다. Flyway는 버전을 마디별로 비교하므로
--   20260729.4 < 20260729.4.1 < 20260729.5 순서가 되어 정확히 그 사이에 들어간다.
--
-- 되돌리는 법: 되돌릴 이유가 없다. (A)와 (B)는 같은 제약이고, 이 파일은 표기만 맞춘다.
--
-- 근거: docs/db/2026-07-30-supabase-to-oci-cutover.md
-- ============================================================================

DO $$
BEGIN
    -- 제약이 없는 환경(빈 DB에서 아직 만들어지기 전 등)에서도 안전하게 통과시킨다.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_projects_eval_status'
          AND conrelid = 'public.projects'::regclass
    ) THEN
        RAISE NOTICE 'chk_projects_eval_status 없음 - 표기 정규화를 건너뛴다';
        RETURN;
    END IF;

    -- 이미 (A) 형태면 아무것도 하지 않는다(재실행 안전).
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_projects_eval_status'
          AND conrelid = 'public.projects'::regclass
          AND pg_get_constraintdef(oid) =
              'CHECK (((eval_status)::text = ANY ((ARRAY[''PENDING''::character varying,'
              || ' ''EVALUATING''::character varying, ''PUBLISHED''::character varying])::text[])))'
    ) THEN
        RETURN;
    END IF;

    -- IN (...) 으로 다시 만들면 PostgreSQL이 (A) 형태로 저장한다(2026-07-30 실측).
    ALTER TABLE projects DROP CONSTRAINT chk_projects_eval_status;
    ALTER TABLE projects ADD CONSTRAINT chk_projects_eval_status
        CHECK (eval_status IN ('PENDING', 'EVALUATING', 'PUBLISHED'));
END $$;
