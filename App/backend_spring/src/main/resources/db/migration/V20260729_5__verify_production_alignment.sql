-- ============================================================================
-- V20260729_3·_4가 실제로 운영 스키마와 같은 상태를 만들었는지 검증한다. DDL은 없다.
--
-- _4의 7절 검증은 객체의 "이름이 있는지"와 일부 속성만 봤다. 그것으로는 부족하다.
-- 이름이 맞아도 대상 컬럼이 다르거나, 참조 테이블이 다르거나, UNIQUE 구성이 다르거나,
-- 인덱스 컬럼 순서가 다르면 운영과 다른 DB인데 통과한다. `eval_status` 기본값도
-- LIKE '%EVALUATING%'로 봐서 'NOT_EVALUATING' 같은 값을 걸러내지 못했다.
--
-- 여기서는 운영에서 그대로 뽑은 정의 문자열과 **완전 일치**를 요구한다.
--   - 제약: pg_get_constraintdef() 전문 (대상 컬럼·참조 대상·ON DELETE·CHECK 식 포함)
--   - 인덱스: pg_indexes.indexdef 전문 (컬럼 구성·순서·UNIQUE 여부 포함)
--   - 컬럼: 타입·NULL 허용·IDENTITY 여부·기본값 완전 일치, varchar 길이 제한 부재
--
-- 기준값은 2026-07-29 운영(PostgreSQL 17.6)에서 조회한 값이다. PostgreSQL 메이저 버전이
-- 바뀌어 출력 포맷이 달라지면 이 파일이 먼저 깨진다. 그때는 기준값을 다시 뽑아
-- 새 V파일로 교체할 것(이 파일은 이미 적용됐을 것이므로 수정하지 않는다).
--
-- _4를 고치지 않고 파일을 새로 만든 이유: _4는 이미 dev에 있어 팀원 로컬에서 실행됐을 수
-- 있다. 적용된 V파일을 고치면 Flyway 체크섬 검증이 깨진다(2026-07-26 운영 41분 중단).
--
-- 근거: docs/trouble-shooting/2026-07-29-supabase-schema-drift.md
-- ============================================================================

DO $$
DECLARE
    bad TEXT;
BEGIN
    SELECT string_agg(msg, E'\n  - ') INTO bad FROM (

        -- (1) 제약 — 정의 문자열 완전 일치
        SELECT CASE
                 WHEN actual.def IS NULL THEN format('제약 %s(%s) 없음', e.con, e.tbl)
                 ELSE format('제약 %s(%s) 정의 불일치%s    기대: %s%s    실제: %s',
                             e.con, e.tbl, E'\n', e.def, E'\n', actual.def)
               END AS msg
        FROM (VALUES
            ('projects',             'chk_projects_eval_status',            'CHECK (((eval_status)::text = ANY ((ARRAY[''PENDING''::character varying, ''EVALUATING''::character varying, ''PUBLISHED''::character varying])::text[])))'),
            ('workload_scores',      'workload_scores_pkey',                'PRIMARY KEY (id)'),
            ('workload_scores',      'fk_workload_scores_project',          'FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE'),
            ('workload_scores',      'fk_workload_scores_user',             'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'),
            ('meeting_action_items', 'uq_action_items_created_task',        'UNIQUE (created_task_id)'),
            ('meeting_action_items', 'fk_action_items_final_assignee',      'FOREIGN KEY (final_assignee_id) REFERENCES users(id)'),
            ('meeting_action_items', 'fk_action_items_recommended_assignee','FOREIGN KEY (recommended_assignee_id) REFERENCES users(id)'),
            ('document_chunks',      'document_chunks_assignee_id_fkey',    'FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL'),
            ('task_result_links',    'task_result_links_task_id_fkey',      'FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE'),
            ('task_results',         'task_results_task_id_fkey',           'FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE'),
            ('meetings',             'fk_meetings_uploaded_by',             'FOREIGN KEY (uploaded_by) REFERENCES users(id)'),
            ('notifications',        'fk_notifications_user',               'FOREIGN KEY (user_id) REFERENCES users(id)'),
            ('tasks',                'fk_tasks_created_by',                 'FOREIGN KEY (created_by) REFERENCES users(id)'),
            ('tasks',                'fk_tasks_source_meeting',             'FOREIGN KEY (source_meeting_id) REFERENCES meetings(id)')
        ) AS e(tbl, con, def)
        LEFT JOIN LATERAL (
            SELECT pg_get_constraintdef(c.oid) AS def
            FROM pg_constraint c
            WHERE c.conname = e.con AND c.conrelid = ('public.' || e.tbl)::regclass
        ) actual ON TRUE
        WHERE actual.def IS DISTINCT FROM e.def

        UNION ALL
        -- (2) 인덱스 — 정의 문자열 완전 일치 (컬럼 구성·순서·UNIQUE 여부 포함)
        SELECT CASE
                 WHEN actual.def IS NULL THEN format('인덱스 %s 없음', e.idx)
                 ELSE format('인덱스 %s 정의 불일치%s    기대: %s%s    실제: %s',
                             e.idx, E'\n', e.def, E'\n', actual.def)
               END
        FROM (VALUES
            ('idx_comments_target',                 'CREATE INDEX idx_comments_target ON public.comments USING btree (target_type, target_id)'),
            ('idx_meeting_action_items_meeting_id', 'CREATE INDEX idx_meeting_action_items_meeting_id ON public.meeting_action_items USING btree (meeting_id)'),
            ('idx_meetings_project_id',             'CREATE INDEX idx_meetings_project_id ON public.meetings USING btree (project_id)'),
            ('idx_notifications_user_id',           'CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id)'),
            ('idx_tasks_project_id',                'CREATE INDEX idx_tasks_project_id ON public.tasks USING btree (project_id)'),
            ('idx_tasks_source_meeting_id',         'CREATE INDEX idx_tasks_source_meeting_id ON public.tasks USING btree (source_meeting_id)')
        ) AS e(idx, def)
        LEFT JOIN LATERAL (
            SELECT i.indexdef AS def FROM pg_indexes i
            WHERE i.schemaname = 'public' AND i.indexname = e.idx
        ) actual ON TRUE
        WHERE actual.def IS DISTINCT FROM e.def

        UNION ALL
        -- (3) 컬럼 — 타입·NULL 허용·IDENTITY·기본값 완전 일치
        SELECT CASE
                 WHEN a.data_type IS NULL THEN format('컬럼 %s.%s 없음', e.tbl, e.col)
                 ELSE format('컬럼 %s.%s 정의 불일치%s    기대: %s/null=%s/ident=%s/default=%s%s    실제: %s/null=%s/ident=%s/default=%s',
                             e.tbl, e.col, E'\n', e.typ, e.nullable, e.ident, coalesce(e.def, '(없음)'), E'\n',
                             a.data_type, a.is_nullable, a.is_identity, coalesce(a.column_default, '(없음)'))
               END
        FROM (VALUES
            ('workload_scores', 'id',             'bigint',                      'NO',  'NO',  'nextval(''workload_scores_id_seq''::regclass)'),
            ('workload_scores', 'project_id',     'bigint',                      'NO',  'NO',  NULL),
            ('workload_scores', 'user_id',        'bigint',                      'NO',  'NO',  NULL),
            ('workload_scores', 'overload_score', 'numeric',                     'NO',  'NO',  NULL),
            ('workload_scores', 'anomaly_type',   'character varying',           'NO',  'NO',  NULL),
            ('workload_scores', 'computed_at',    'timestamp without time zone', 'NO',  'NO',  'CURRENT_TIMESTAMP'),
            ('projects',        'eval_status',    'character varying',           'NO',  'NO',  '''EVALUATING''::character varying'),
            ('tasks',           'position',       'double precision',            'NO',  'NO',  NULL),
            ('tasks',           'move_version',   'bigint',                      'NO',  'NO',  '0'),
            ('meeting_action_items', 'id',        'bigint',                      'NO',  'YES', NULL),
            ('notifications',   'id',             'bigint',                      'NO',  'YES', NULL)
        ) AS e(tbl, col, typ, nullable, ident, def)
        LEFT JOIN LATERAL (
            SELECT c.data_type, c.is_nullable, c.is_identity, c.column_default
            FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
        ) a ON TRUE
        WHERE a.data_type IS DISTINCT FROM e.typ
           OR a.is_nullable IS DISTINCT FROM e.nullable
           OR a.is_identity IS DISTINCT FROM e.ident
           OR a.column_default IS DISTINCT FROM e.def

        UNION ALL
        -- (4) varchar 길이 제한이 남아 있는지 (운영은 전부 길이 없는 varchar)
        SELECT format('%s.%s에 varchar 길이 제한(%s)이 남아 있다', e.tbl, e.col, c.character_maximum_length)
        FROM (VALUES
            ('meeting_action_items','category'), ('meeting_action_items','priority'),
            ('meeting_action_items','title'),    ('meeting_analysis','analysis_engine'),
            ('meetings','meeting_type'),         ('meetings','original_file_name'),
            ('notifications','target_type'),     ('notifications','title'),
            ('notifications','type'),            ('tasks','source_type')
        ) AS e(tbl, col)
        JOIN information_schema.columns c
          ON c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.col
        WHERE c.character_maximum_length IS NOT NULL

    ) t;

    IF bad IS NOT NULL THEN
        RAISE EXCEPTION E'운영 스키마와 다른 정의가 남아 있다:\n  - %', bad;
    END IF;
END $$;
