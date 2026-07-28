-- ============================================================================
-- WorkFlow AI - 회의록 AI 관련 추가 스키마 (2026-07 회의록 AI 기능 확장)
-- 01_base_schema.sql(PRD 기준 20개 테이블) 이후에 실행됨.
-- 실제 Supabase(information_schema 조회, 2026-07-15)와 대조해 맞춘 DDL이다.
-- ============================================================================

-- meetings: 회의록 AI 업로드/분석 흐름에 필요한 메타데이터 컬럼 추가
ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS meeting_date        DATE,
    ADD COLUMN IF NOT EXISTS meeting_type        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS original_file_name  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS uploaded_by         BIGINT NULL,
    ADD COLUMN IF NOT EXISTS file_size           BIGINT;

ALTER TABLE meetings
    ADD CONSTRAINT fk_meetings_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN meetings.meeting_date IS '회의 날짜 (분석 요청 시 입력)';
COMMENT ON COLUMN meetings.meeting_type IS '정기회의/중간점검/발표준비 등';
COMMENT ON COLUMN meetings.original_file_name IS '업로드 원본 파일명';
COMMENT ON COLUMN meetings.uploaded_by IS '업로드한 사용자';
COMMENT ON COLUMN meetings.file_size IS '업로드 파일 크기(byte)';

-- meeting_analysis: 분석 엔진 출처와 키워드 추가
ALTER TABLE meeting_analysis
    ADD COLUMN IF NOT EXISTS analysis_engine VARCHAR(20),
    ADD COLUMN IF NOT EXISTS keywords        JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN meeting_analysis.analysis_engine IS 'FASTAPI/SPRING_FALLBACK';
COMMENT ON COLUMN meeting_analysis.keywords IS 'AI가 추출한 핵심 키워드 목록';

-- tasks: 회의록 AI로 생성된 업무 추적용 컬럼 추가
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS source_type       VARCHAR(20),
    ADD COLUMN IF NOT EXISTS source_meeting_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS created_by        BIGINT NULL;

ALTER TABLE tasks
    ADD CONSTRAINT fk_tasks_source_meeting FOREIGN KEY (source_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_tasks_created_by     FOREIGN KEY (created_by)        REFERENCES users(id)    ON DELETE SET NULL;

COMMENT ON COLUMN tasks.source_type IS 'MEETING_AI/MANUAL 등 업무 생성 출처';
COMMENT ON COLUMN tasks.source_meeting_id IS '회의록 AI로 생성된 경우 원본 회의록';
COMMENT ON COLUMN tasks.created_by IS '업무를 실제로 등록한 사용자(팀장 승인자)';

-- comments: 폴리모픽 대상 id 추가 (target_type이 무엇을 가리키는지)
ALTER TABLE comments
    ADD COLUMN IF NOT EXISTS target_id BIGINT;

COMMENT ON COLUMN comments.target_id IS 'target_type에 따른 대상 id (폴리모픽, FK 제약 없음)';

-- meeting_action_items: 회의록 AI가 생성한 To-Do 후보 (팀장 승인 전/후 상태 추적)
CREATE TABLE meeting_action_items (
    id                       BIGSERIAL PRIMARY KEY,
    meeting_id               BIGINT NULL,
    title                    VARCHAR(200) NOT NULL,
    description              TEXT,
    category                 VARCHAR(50),
    recommended_assignee_id  BIGINT NULL,
    final_assignee_id        BIGINT NULL,
    due_date                 DATE,
    priority                 VARCHAR(20),
    basis                    TEXT,
    approved                 BOOLEAN NOT NULL DEFAULT FALSE,
    created_task_id          BIGINT NULL,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_action_items_meeting     FOREIGN KEY (meeting_id)              REFERENCES meetings(id) ON DELETE SET NULL,
    CONSTRAINT fk_action_items_recommended FOREIGN KEY (recommended_assignee_id) REFERENCES users(id)    ON DELETE SET NULL,
    CONSTRAINT fk_action_items_assignee    FOREIGN KEY (final_assignee_id)       REFERENCES users(id)    ON DELETE SET NULL,
    CONSTRAINT fk_action_items_task        FOREIGN KEY (created_task_id)         REFERENCES tasks(id)    ON DELETE SET NULL
);
COMMENT ON TABLE meeting_action_items IS '회의록 AI To-Do 후보 (승인 전/후 상태 및 등록된 업무 추적)';
COMMENT ON COLUMN meeting_action_items.recommended_assignee_id IS 'AI가 추천한 담당자 (이름 매칭으로 해석된 user id)';
COMMENT ON COLUMN meeting_action_items.basis IS '업무 생성 근거';
COMMENT ON COLUMN meeting_action_items.approved IS '팀장 승인 여부';
COMMENT ON COLUMN meeting_action_items.created_task_id IS '팀장 승인 후 등록된 실제 업무 (중복 등록 방지 기준)';

-- notifications: 업무 등록/코멘트 등에 대한 사용자 알림
CREATE TABLE notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    type        VARCHAR(50) NOT NULL,
    title       VARCHAR(200) NOT NULL,
    content     TEXT,
    target_type VARCHAR(50),
    target_id   BIGINT NULL,
    project_id  BIGINT NULL,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
COMMENT ON TABLE notifications IS '사용자 알림 (업무 배정, 코멘트 등)';
COMMENT ON COLUMN notifications.type IS '알림 종류 (예: TASK_ASSIGNED)';
COMMENT ON COLUMN notifications.target_type IS '알림이 가리키는 대상 종류 (예: task)';
COMMENT ON COLUMN notifications.target_id IS '대상 id (예: task id, 폴리모픽, FK 제약 없음)';
COMMENT ON COLUMN notifications.project_id IS '알림을 분리해서 표시할 프로젝트 id';
CREATE INDEX idx_notifications_user_project_created
    ON notifications (user_id, project_id, created_at DESC);
