-- ============================================================================
-- 2026-07-26 결정 문서가 "OCI 이관 시 baseline 재설계와 함께 정리"로 미뤄뒀던
-- legacy divergence 30건을 운영 Supabase 기준으로 정합화한다.
--
-- 전부 운영에는 이미 그 상태이므로 운영에서는 no-op이고, 빈 DB에서만 실제로 바뀐다.
-- 각 블록은 현재 상태를 먼저 확인한 뒤에만 DDL을 실행한다(재실행 안전).
--
-- 주의: 아래 3절(FK ON DELETE 제거)은 빈 DB를 운영과 "같게" 만들지만 "더 낫게"
-- 만들지는 않는다. 운영 쪽 FK 4개에 ON DELETE 절이 없어 부모 행 삭제가 막히는데,
-- 그 동작을 새 환경에도 그대로 옮기는 것이다. 어느 쪽이 옳은지는 별도 판단이 필요하다.
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
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workload_scores_project') THEN
        ALTER TABLE workload_scores ADD CONSTRAINT fk_workload_scores_project
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workload_scores_user') THEN
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
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.old_name)
           AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.new_name) THEN
            EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.old_name, r.new_name);
        END IF;
    END LOOP;
END $$;

-- meeting_action_items의 담당자 FK 2건은 이름과 ON DELETE가 동시에 다르므로 재생성한다.
DO $$
BEGIN
    ALTER TABLE meeting_action_items DROP CONSTRAINT IF EXISTS fk_action_items_assignee;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_action_items_final_assignee') THEN
        ALTER TABLE meeting_action_items ADD CONSTRAINT fk_action_items_final_assignee
            FOREIGN KEY (final_assignee_id) REFERENCES users(id);
    END IF;

    ALTER TABLE meeting_action_items DROP CONSTRAINT IF EXISTS fk_action_items_recommended;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_action_items_recommended_assignee') THEN
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
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.con AND confdeltype <> 'a') THEN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.con);
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I)',
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
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE VARCHAR', r.tbl, r.col);
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

            seq := pg_get_serial_sequence(r.tbl, 'id');
            EXECUTE format('ALTER TABLE %I ALTER COLUMN id DROP DEFAULT', r.tbl);
            IF seq IS NOT NULL THEN
                EXECUTE format('ALTER SEQUENCE %s OWNED BY NONE', seq);
                EXECUTE format('DROP SEQUENCE %s', seq);
            END IF;
            EXECUTE format('ALTER TABLE %I ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY', r.tbl);

            -- 기존 행이 있으면 다음 값이 겹치지 않게 맞춘다(빈 DB에서는 1).
            EXECUTE format('SELECT coalesce(max(id), 0) + 1 FROM %I', r.tbl) INTO next_val;
            EXECUTE format('ALTER TABLE %I ALTER COLUMN id RESTART WITH %s', r.tbl, next_val);
        END IF;
    END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 6. 운영에만 있던 인덱스·유니크 제약.
--    uq_action_items_created_task는 실제 무결성 차이다 — 회의 액션 아이템 하나가
--    업무 하나만 만들도록 강제한다. 나머지 6개는 조회 성능용이다.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_action_items_created_task') THEN
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
