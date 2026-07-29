-- ============================================================================
-- 2026-07-26 결정 문서가 "OCI 이관 시 baseline 재설계와 함께 정리"로 미뤄뒀던
-- legacy divergence 30건을 운영 Supabase 기준으로 정합화한다.
--
-- 운영은 이미 목표 상태라 모든 블록의 가드가 걸려 실질적으로 실행되는 것이 없다.
-- 빈 DB와, 정합화 전에 만들어진 로컬·스테이징 DB에서만 실제로 바뀐다.
--
-- 주의 1: 3절(FK ON DELETE 제거)은 빈 DB를 운영과 "같게" 만들지만 "더 낫게" 만들지는
-- 않는다. 운영 쪽 FK 4개에 ON DELETE 절이 없어 부모 행 삭제가 막히는데, 그 동작을 새
-- 환경에도 그대로 옮기는 것이다. 어느 쪽이 옳은지는 별도 판단이 필요하다.
--
-- 주의 2: 제약·인덱스 존재 확인은 반드시 스키마와 테이블까지 한정한다. PostgreSQL의
-- 제약 이름은 테이블 단위로만 유일해서, conname만 보면 다른 테이블이나 다른 스키마
-- (Supabase의 auth·storage 등)의 동명 제약에 걸려 작업을 잘못 건너뛴다.
--
-- 근거: docs/trouble-shooting/2026-07-29-supabase-schema-drift.md
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. workload_scores — 운영에만 있고 docs/db/workflow_ai_schema.sql 스냅샷에만
--    정의돼 있던 테이블. 실행 경로가 없어 빈 DB에는 만들어지지 않았다.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workload_scores (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL,
    user_id        BIGINT NOT NULL,
    overload_score NUMERIC(5,2) NOT NULL,
    anomaly_type   VARCHAR(20) NOT NULL,
    computed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workload_scores IS 'FS-5 업무 편중 점수 스냅샷 (재계산마다 새 row, contribution_reports와 동일한 이력 저장 방식)';
COMMENT ON COLUMN workload_scores.anomaly_type IS '정상/과부하 의심/저활동 의심/이상 패턴(방향 불명확) 중 하나';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'fk_workload_scores_project'
                     AND conrelid = 'public.workload_scores'::regclass) THEN
        ALTER TABLE workload_scores ADD CONSTRAINT fk_workload_scores_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'fk_workload_scores_user'
                     AND conrelid = 'public.workload_scores'::regclass) THEN
        ALTER TABLE workload_scores ADD CONSTRAINT fk_workload_scores_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. FK 이름 통일 — 같은 관계인데 이름이 갈려 있던 5건.
--    운영 이름을 기준으로 삼는다. 이 중 2건은 ON DELETE 절도 함께 사라진다(3절 참조).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('document_chunks',   'fk_chunks_assignee',         'document_chunks_assignee_id_fkey'),
            ('task_result_links', 'fk_task_result_links_task',  'task_result_links_task_id_fkey'),
            ('task_results',      'fk_task_results_task',       'task_results_task_id_fkey')
        ) AS t(tbl, old_name, new_name)
    LOOP
        IF EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = r.old_name AND conrelid = ('public.' || r.tbl)::regclass)
           AND NOT EXISTS (SELECT 1 FROM pg_constraint
                           WHERE conname = r.new_name AND conrelid = ('public.' || r.tbl)::regclass) THEN
            EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', r.tbl, r.old_name, r.new_name);
        END IF;
    END LOOP;
END $$;

-- meeting_action_items의 담당자 FK 2건은 이름과 ON DELETE가 동시에 다르므로 재생성한다.
DO $$
BEGIN
    ALTER TABLE meeting_action_items DROP CONSTRAINT IF EXISTS fk_action_items_assignee;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'fk_action_items_final_assignee'
                     AND conrelid = 'public.meeting_action_items'::regclass) THEN
        ALTER TABLE meeting_action_items ADD CONSTRAINT fk_action_items_final_assignee
            FOREIGN KEY (final_assignee_id) REFERENCES users(id);
    END IF;

    ALTER TABLE meeting_action_items DROP CONSTRAINT IF EXISTS fk_action_items_recommended;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'fk_action_items_recommended_assignee'
                     AND conrelid = 'public.meeting_action_items'::regclass) THEN
        ALTER TABLE meeting_action_items ADD CONSTRAINT fk_action_items_recommended_assignee
            FOREIGN KEY (recommended_assignee_id) REFERENCES users(id);
    END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 3. FK ON DELETE 절 제거 — 운영에는 없는 절이 빈 DB에만 붙어 있던 4건.
--    제거하면 부모 행 삭제가 RESTRICT(기본값)로 막힌다. 운영의 현재 동작이다.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('meetings',      'fk_meetings_uploaded_by',  'uploaded_by',       'users',    'id'),
            ('notifications', 'fk_notifications_user',    'user_id',           'users',    'id'),
            ('tasks',         'fk_tasks_created_by',      'created_by',        'users',    'id'),
            ('tasks',         'fk_tasks_source_meeting',  'source_meeting_id', 'meetings', 'id')
        ) AS t(tbl, con, col, ref_tbl, ref_col)
    LOOP
        -- confdeltype 'a' = NO ACTION(=절 없음). 그 외일 때만 재생성한다.
        IF EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = r.con
                     AND conrelid = ('public.' || r.tbl)::regclass
                     AND confdeltype <> 'a') THEN
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.con);
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I)',
                           r.tbl, r.con, r.col, r.ref_tbl, r.ref_col);
        END IF;
    END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 4. varchar 길이 제한 제거 — 운영이 전부 길이 없는 varchar다.
--    JPA @Column(length=...)는 Hibernate 검증 대상이 아니라 앱 동작에 영향이 없다.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('meeting_action_items', 'category'),
            ('meeting_action_items', 'priority'),
            ('meeting_action_items', 'title'),
            ('meeting_analysis',     'analysis_engine'),
            ('meetings',             'meeting_type'),
            ('meetings',             'original_file_name'),
            ('notifications',        'target_type'),
            ('notifications',        'title'),
            ('notifications',        'type'),
            ('tasks',                'source_type')
        ) AS t(tbl, col)
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
              AND character_maximum_length IS NOT NULL
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE VARCHAR', r.tbl, r.col);
        END IF;
    END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 5. serial → IDENTITY — 운영은 GENERATED BY DEFAULT AS IDENTITY, 빈 DB는 serial.
--    JPA의 GenerationType.IDENTITY는 양쪽 모두에서 동작하지만 정의를 맞춘다.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
    seq TEXT;
    next_val BIGINT;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES ('meeting_action_items'), ('notifications')) AS t(tbl)
    LOOP
        IF (SELECT is_identity FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = 'id') = 'NO' THEN

            seq := pg_get_serial_sequence('public.' || r.tbl, 'id');
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT', r.tbl);
            IF seq IS NOT NULL THEN
                EXECUTE format('ALTER SEQUENCE %s OWNED BY NONE', seq);
                EXECUTE format('DROP SEQUENCE %s', seq);
            END IF;
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY', r.tbl);

            -- 기존 행이 있으면 다음 값이 겹치지 않게 맞춘다(빈 DB에서는 1).
            EXECUTE format('SELECT coalesce(max(id), 0) + 1 FROM public.%I', r.tbl) INTO next_val;
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id RESTART WITH %s', r.tbl, next_val);
        END IF;
    END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 6. 운영에만 있던 인덱스·유니크 제약.
--    uq_action_items_created_task는 실제 무결성 차이다 — 회의 액션 아이템 하나가
--    업무 하나만 만들도록 강제한다. 나머지 6개는 조회 성능용이다.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    dups TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'uq_action_items_created_task'
                     AND conrelid = 'public.meeting_action_items'::regclass) THEN

        -- 같은 업무를 가리키는 액션 아이템이 둘 이상이면 제약을 걸 수 없다. 운영에는 이미
        -- 제약이 있어 그런 행이 없지만, 정합화 전에 만들어진 로컬·스테이징 DB에는 있을 수
        -- 있다. 여기서 자동으로 연결을 끊지 않는다 — 어느 쪽이 진짜 연결인지는 이 파일이
        -- 알 수 없고, 스키마 마이그레이션이 조용히 데이터를 바꾸면 안 된다.
        -- 대신 대상 행과 해소 방법을 알려주고 멈춘다.
        SELECT string_agg(format('created_task_id=%s (action_item id: %s)', created_task_id, ids), '; ')
        INTO dups
        FROM (
            SELECT created_task_id, string_agg(id::text, ',' ORDER BY id) AS ids
            FROM meeting_action_items
            WHERE created_task_id IS NOT NULL
            GROUP BY created_task_id
            HAVING count(*) > 1
        ) d;

        IF dups IS NOT NULL THEN
            RAISE EXCEPTION
                'uq_action_items_created_task를 걸 수 없다. 한 업무를 여러 액션 아이템이 가리킨다: %'
                '  --  어느 연결이 맞는지 확인한 뒤 나머지를 해제하고 다시 실행할 것. '
                '예) UPDATE meeting_action_items SET created_task_id = NULL WHERE id IN (...);',
                dups;
        END IF;

        ALTER TABLE meeting_action_items ADD CONSTRAINT uq_action_items_created_task
            UNIQUE (created_task_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comments_target                ON comments (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting_id ON meeting_action_items (meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_project_id            ON meetings (project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id          ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id               ON tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source_meeting_id        ON tasks (source_meeting_id);


-- ----------------------------------------------------------------------------
-- 7. 최종 상태 검증 — 존재 여부가 아니라 "정의"를 확인한다.
--
--    위 블록들은 전부 상태 가드를 쓴다. 가드는 "없으면 만든다"만 보장하고 "있으면
--    최신으로 맞춘다"를 보장하지 않는다. 이번 divergence를 만든 성질이 바로 그것이라,
--    존재만 확인하면 같은 함정을 되풀이한다. 그래서 타입·NULL 허용·기본값·FK 삭제 동작·
--    varchar 길이·IDENTITY 여부까지 운영 기준값과 대조한다.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    bad TEXT;
BEGIN
    SELECT string_agg(msg, E'\n  - ') INTO bad FROM (

        -- (1) workload_scores 컬럼: 타입·NULL 허용까지 확인
        SELECT format('workload_scores.%s 정의 불일치(기대 %s/%s)', e.col, e.typ, e.nullable) AS msg
        FROM (VALUES
            ('id','bigint','NO'), ('project_id','bigint','NO'), ('user_id','bigint','NO'),
            ('overload_score','numeric','NO'), ('anomaly_type','character varying','NO'),
            ('computed_at','timestamp without time zone','NO')
        ) AS e(col, typ, nullable)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.table_name='workload_scores'
              AND c.column_name=e.col AND c.data_type=e.typ AND c.is_nullable=e.nullable)

        UNION ALL
        -- (2) 제약: 이름이 "그 테이블에" 있는지
        SELECT format('제약 %s 없음(%s)', e.con, e.tbl)
        FROM (VALUES
            ('workload_scores','workload_scores_pkey'),
            ('workload_scores','fk_workload_scores_project'),
            ('workload_scores','fk_workload_scores_user'),
            ('meeting_action_items','uq_action_items_created_task'),
            ('meeting_action_items','fk_action_items_final_assignee'),
            ('meeting_action_items','fk_action_items_recommended_assignee'),
            ('document_chunks','document_chunks_assignee_id_fkey'),
            ('task_result_links','task_result_links_task_id_fkey'),
            ('task_results','task_results_task_id_fkey')
        ) AS e(tbl, con)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname=e.con AND conrelid=('public.'||e.tbl)::regclass)

        UNION ALL
        -- (3) FK 삭제 동작: 운영은 절이 없다(confdeltype='a')
        SELECT format('FK %s(%s)의 ON DELETE가 남아 있다', e.con, e.tbl)
        FROM (VALUES
            ('meetings','fk_meetings_uploaded_by'), ('notifications','fk_notifications_user'),
            ('tasks','fk_tasks_created_by'), ('tasks','fk_tasks_source_meeting'),
            ('meeting_action_items','fk_action_items_final_assignee'),
            ('meeting_action_items','fk_action_items_recommended_assignee')
        ) AS e(tbl, con)
        WHERE EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname=e.con AND conrelid=('public.'||e.tbl)::regclass AND confdeltype <> 'a')

        UNION ALL
        -- (4) varchar 길이 제한이 남아 있는지
        SELECT format('%s.%s에 varchar 길이 제한이 남아 있다', e.tbl, e.col)
        FROM (VALUES
            ('meeting_action_items','category'), ('meeting_action_items','priority'),
            ('meeting_action_items','title'), ('meeting_analysis','analysis_engine'),
            ('meetings','meeting_type'), ('meetings','original_file_name'),
            ('notifications','target_type'), ('notifications','title'),
            ('notifications','type'), ('tasks','source_type')
        ) AS e(tbl, col)
        WHERE EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=e.tbl AND column_name=e.col
              AND character_maximum_length IS NOT NULL)

        UNION ALL
        -- (5) IDENTITY 전환 여부
        SELECT format('%s.id가 IDENTITY가 아니다', e.tbl)
        FROM (VALUES ('meeting_action_items'), ('notifications')) AS e(tbl)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=e.tbl AND column_name='id'
              AND is_identity='YES')

        UNION ALL
        -- (6) 인덱스
        SELECT format('인덱스 %s 없음', e.idx)
        FROM (VALUES
            ('idx_comments_target'), ('idx_meeting_action_items_meeting_id'),
            ('idx_meetings_project_id'), ('idx_notifications_user_id'),
            ('idx_tasks_project_id'), ('idx_tasks_source_meeting_id')
        ) AS e(idx)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=e.idx)

        UNION ALL
        -- (7) V20260729_3이 맞춘 항목도 함께 확인한다(같은 배포에서 함께 적용된다)
        SELECT 'projects.eval_status 기본값이 EVALUATING이 아니다'
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='projects' AND column_name='eval_status'
              AND column_default LIKE '%EVALUATING%')

        UNION ALL
        SELECT 'tasks.position에 기본값이 남아 있다'
        WHERE EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='tasks' AND column_name='position'
              AND column_default IS NOT NULL)

        UNION ALL
        SELECT 'tasks.move_version이 없다'
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='tasks' AND column_name='move_version')

    ) t;

    IF bad IS NOT NULL THEN
        RAISE EXCEPTION E'정합화 후에도 운영과 다른 정의가 남아 있다:\n  - %', bad;
    END IF;
END $$;
