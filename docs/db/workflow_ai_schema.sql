-- ============================================================================
-- WorkFlow AI - Database Schema (PostgreSQL DDL)
-- 출처: Supabase 프로젝트 "work-flow" (ref: zzfcnbbzmbxzxptxghhq) 실제 스키마
--       (supabase db dump --schema public, 2026-07-22 기준)
-- 스코프: 실사용 스키마 전체 (27개 테이블)
-- 용도: 실제 서비스 스택(PostgreSQL/Supabase)에 직접 실행 가능한 DDL
-- 요구 버전: PostgreSQL 13+ (실 운영: PostgreSQL 17, Supabase 관리형 인스턴스로 pgvector 사전 번들)
--       자체 호스팅 PostgreSQL에서는 pgvector가 기본 포함되지 않으므로 CREATE EXTENSION 실행
--       전에 서버에 pgvector 확장을 별도로 설치해야 한다 (예: apt install postgresql-17-pgvector).
-- 주의: document_chunks.embedding은 pgvector VECTOR(1024) 사용 중 (BAAI/bge-m3 기반
--       쿼리 노이즈 강건성 파인튜닝 모델 차원). 아래 CREATE EXTENSION vector 구문 포함.
-- 주의: 이 파일은 "빈 DB에 처음 실행하는" 스냅샷 DDL이다. 이미 데이터가 있는 기존 DB에
--       마이그레이션으로 그대로 적용하지 말 것 — NOT NULL 컬럼 추가, VECTOR 차원 변경 등은
--       기존 행/인덱스와 충돌해 실패하거나 데이터를 깨뜨릴 수 있다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- updated_at 자동 갱신 트리거 함수 (MySQL의 ON UPDATE CURRENT_TIMESTAMP 대체)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. 인증 / 프로젝트
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    provider        VARCHAR(20)  NOT NULL,
    provider_id     VARCHAR(255) NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    password_hash   VARCHAR(255),
    reviewer_status VARCHAR(20),
    affiliation     VARCHAR(100),
    field           JSONB NOT NULL DEFAULT '[]',
    github_username VARCHAR(100),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_provider UNIQUE (provider, provider_id)
);
COMMENT ON TABLE users IS '사용자';
COMMENT ON COLUMN users.provider IS 'google 등 OAuth 제공자';
COMMENT ON COLUMN users.provider_id IS 'OAuth sub (불변 식별자)';
COMMENT ON COLUMN users.password_hash IS '로컬(이메일/비밀번호) 회원가입 계정만 사용. BCrypt 해시. Google/데모 계정은 NULL.';
COMMENT ON COLUMN users.reviewer_status IS 'REVIEWER로 가입 신청한 계정만 사용: PENDING(승인 대기)/APPROVED(승인 완료). NULL이면 심사자 신청 이력 없음.';
COMMENT ON COLUMN users.affiliation IS '소속 (예: 컴퓨터공학과 3학년)';
COMMENT ON COLUMN users.field IS '전공/관심 분야 태그 배열 (예: ["백엔드", "인프라"])';
COMMENT ON COLUMN users.github_username IS 'GitHub 아이디만 저장한다 (URL 아님)';

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE projects (
    id             BIGSERIAL PRIMARY KEY,
    title          VARCHAR(200) NOT NULL,
    type           VARCHAR(50),
    deadline       DATE,
    description    TEXT,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    start_date     DATE,
    mid_check_date DATE,
    member_limit   INTEGER,
    deliverables   JSONB,
    tech_stack     JSONB,
    goals          TEXT,
    invite_code    VARCHAR(20),
    created_by     BIGINT NULL,
    CONSTRAINT uq_projects_invite_code UNIQUE (invite_code),
    CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
COMMENT ON TABLE projects IS '프로젝트';
COMMENT ON COLUMN projects.type IS '캡스톤디자인/해커톤/공모전 등';
COMMENT ON COLUMN projects.mid_check_date IS '중간 점검/중간보고일 (선택)';
COMMENT ON COLUMN projects.member_limit IS '예상 참여 인원 수';
COMMENT ON COLUMN projects.deliverables IS '목표 산출물 목록 (예: ["발표자료","보고서"])';
COMMENT ON COLUMN projects.tech_stack IS '기술 스택/주요 기능 키워드 목록';
COMMENT ON COLUMN projects.goals IS '진행 목표/간단 메모';
COMMENT ON COLUMN projects.invite_code IS '초대 코드 (온보딩 시 자동 생성)';
COMMENT ON COLUMN projects.created_by IS '생성자 user id';

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE project_members (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    role       VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_members UNIQUE (project_id, user_id),
    CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE project_members IS '프로젝트 멤버십/역할';
COMMENT ON COLUMN project_members.role IS '팀장/팀원/심사자 (프로젝트별 role)';

CREATE TABLE invitations (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    email      VARCHAR(255) NOT NULL,
    role       VARCHAR(20)  NOT NULL,
    token      VARCHAR(255) NOT NULL,
    status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invitations_token UNIQUE (token),
    CONSTRAINT fk_inv_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE invitations IS '팀원/심사자 초대';
COMMENT ON COLUMN invitations.status IS 'pending/accepted/expired';

-- ----------------------------------------------------------------------------
-- 2. 업무 / 마일스톤
-- ----------------------------------------------------------------------------

CREATE TABLE milestones (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    title      VARCHAR(200) NOT NULL,
    due_date   DATE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE milestones IS '프로젝트 마일스톤';

CREATE TABLE tasks (
    id                BIGSERIAL PRIMARY KEY,
    project_id        BIGINT NOT NULL,
    milestone_id      BIGINT NULL,
    title             VARCHAR(200) NOT NULL,
    category          VARCHAR(50)  NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    assignee_id       BIGINT NULL,
    due_date          DATE,
    priority          VARCHAR(20),
    description       TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_type       VARCHAR(50),
    source_meeting_id BIGINT NULL,
    created_by        BIGINT NULL,
    "position"        DOUBLE PRECISION NOT NULL,
    CONSTRAINT fk_tasks_project       FOREIGN KEY (project_id)        REFERENCES projects(id)  ON DELETE CASCADE,
    CONSTRAINT fk_tasks_assignee      FOREIGN KEY (assignee_id)       REFERENCES users(id)     ON DELETE SET NULL,
    CONSTRAINT fk_tasks_milestone     FOREIGN KEY (milestone_id)      REFERENCES milestones(id) ON DELETE SET NULL,
    CONSTRAINT fk_tasks_created_by    FOREIGN KEY (created_by)        REFERENCES users(id)
    -- fk_tasks_source_meeting은 meetings 테이블 생성 이후 §3에서 ALTER TABLE로 추가한다
    --  (meetings가 아래(§3)에 정의되므로 순방향 참조를 피하기 위함)
);
COMMENT ON TABLE tasks IS '업무 보드 항목';
COMMENT ON COLUMN tasks.category IS '기획/프론트엔드/백엔드/AI-ML 등 18종';
COMMENT ON COLUMN tasks.status IS '할 일/진행 중/보류-블로커/완료';
COMMENT ON COLUMN tasks.assignee_id IS '미배정 가능';
COMMENT ON COLUMN tasks.source_type IS '회의록 액션 아이템에서 생성된 경우 출처 구분';
COMMENT ON COLUMN tasks."position" IS '보드 내 드래그 정렬 순서(부동소수 기반). DEFAULT 없는 NOT NULL — INSERT 시 애플리케이션이 반드시 값을 계산해 넣어야 함';

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tasks_project_id ON tasks (project_id);
CREATE INDEX idx_tasks_source_meeting_id ON tasks (source_meeting_id);

CREATE TABLE task_checklists (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    title      VARCHAR(200) NOT NULL,
    is_done    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_checklists_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_checklists IS '업무 체크리스트';

CREATE TABLE task_comments (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    author_id  BIGINT NOT NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    type       VARCHAR(20) NOT NULL DEFAULT 'COMMENT',
    CONSTRAINT fk_task_comments_task   FOREIGN KEY (task_id)   REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_comments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_comments IS '업무 코멘트';

CREATE INDEX idx_task_comments_task ON task_comments (task_id);

CREATE TABLE task_results (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_task_results_task_id UNIQUE (task_id),
    CONSTRAINT fk_task_results_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_results IS '업무당 1개, 작업 내용 작성 upsert';

CREATE TRIGGER trg_task_results_updated_at
    BEFORE UPDATE ON task_results
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_result_files (
    id           BIGSERIAL PRIMARY KEY,
    task_id      BIGINT NOT NULL,
    file_name    VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL,
    size         BIGINT NOT NULL,
    content_type VARCHAR(100),
    uploaded_by  BIGINT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_result_files_task     FOREIGN KEY (task_id)     REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_result_files_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_task_result_files_task ON task_result_files (task_id);

CREATE TABLE task_result_links (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    url        TEXT NOT NULL,
    title      VARCHAR(200) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_result_links_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_task_result_links_task ON task_result_links (task_id);

-- ----------------------------------------------------------------------------
-- 3. 회의록 AI
-- ----------------------------------------------------------------------------

CREATE TABLE meetings (
    id                  BIGSERIAL PRIMARY KEY,
    project_id          BIGINT NOT NULL,
    title               VARCHAR(200),
    file_type           VARCHAR(20) NOT NULL,
    file_path           VARCHAR(500),
    transcript          TEXT,
    analysis_status     VARCHAR(20) NOT NULL DEFAULT 'pending',
    analysis_job_id     UUID,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meeting_date        DATE,
    meeting_type        VARCHAR(50),
    original_file_name  VARCHAR(255),
    uploaded_by         BIGINT NULL,
    file_size           BIGINT,
    CONSTRAINT fk_meetings_project     FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_meetings_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
COMMENT ON TABLE meetings IS '회의록/녹음 업로드';
COMMENT ON COLUMN meetings.file_type IS 'document/audio/video';
COMMENT ON COLUMN meetings.analysis_status IS '비동기 분석 상태';
COMMENT ON COLUMN meetings.analysis_job_id IS '현재 Redis Stream 분석 작업의 세대 식별자';

CREATE INDEX idx_meetings_project_id ON meetings (project_id);

-- tasks.source_meeting_id는 meetings보다 먼저(§2) 정의되므로 순방향 참조를 피해 여기서 추가한다
ALTER TABLE tasks
    ADD CONSTRAINT fk_tasks_source_meeting FOREIGN KEY (source_meeting_id) REFERENCES meetings(id);

CREATE TABLE meeting_attendees (
    id         BIGSERIAL PRIMARY KEY,
    meeting_id BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    CONSTRAINT uq_meeting_attendees UNIQUE (meeting_id, user_id),
    CONSTRAINT fk_attendees_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    CONSTRAINT fk_attendees_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE meeting_attendees IS '회의 참석자 태깅 (기여도 근거로도 사용)';

CREATE TABLE meeting_analysis (
    meeting_id      BIGINT PRIMARY KEY,
    summary         TEXT,
    decisions       JSONB,
    risks           JSONB,
    action_items    JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    analysis_engine VARCHAR(50),
    keywords        JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT fk_analysis_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
COMMENT ON TABLE meeting_analysis IS '회의록 AI 분석 결과';
COMMENT ON COLUMN meeting_analysis.meeting_id IS '1:1 - meetings.id';
COMMENT ON COLUMN meeting_analysis.decisions IS '결정사항 목록';
COMMENT ON COLUMN meeting_analysis.risks IS '위험요소 목록';
COMMENT ON COLUMN meeting_analysis.action_items IS 'To-Do 후보 목록';

CREATE TABLE meeting_action_items (
    id                       BIGSERIAL PRIMARY KEY,
    meeting_id               BIGINT NULL,
    title                    VARCHAR(200) NOT NULL,
    description              TEXT,
    recommended_assignee_id  BIGINT NULL,
    final_assignee_id        BIGINT NULL,
    due_date                 DATE,
    priority                 VARCHAR(20),
    category                 VARCHAR(50),
    basis                    TEXT,
    approved                 BOOLEAN NOT NULL DEFAULT FALSE,
    created_task_id          BIGINT NULL,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_action_items_created_task UNIQUE (created_task_id),
    CONSTRAINT fk_action_items_meeting               FOREIGN KEY (meeting_id)              REFERENCES meetings(id) ON DELETE SET NULL,
    CONSTRAINT fk_action_items_recommended_assignee  FOREIGN KEY (recommended_assignee_id) REFERENCES users(id),
    CONSTRAINT fk_action_items_final_assignee        FOREIGN KEY (final_assignee_id)       REFERENCES users(id),
    CONSTRAINT fk_action_items_created_task          FOREIGN KEY (created_task_id)         REFERENCES tasks(id)
);
COMMENT ON TABLE meeting_action_items IS '회의록 분석에서 추출된 액션 아이템 (승인 후 업무로 전환)';
COMMENT ON COLUMN meeting_action_items.recommended_assignee_id IS 'AI 추천 담당자';
COMMENT ON COLUMN meeting_action_items.final_assignee_id IS '실제 확정된 담당자';
COMMENT ON COLUMN meeting_action_items.basis IS '추천 근거';
COMMENT ON COLUMN meeting_action_items.approved IS '팀장 승인 후 업무 보드로 전환됨';
COMMENT ON COLUMN meeting_action_items.created_task_id IS '승인 시 생성된 tasks.id (선택적 1:1)';

CREATE INDEX idx_meeting_action_items_meeting_id ON meeting_action_items (meeting_id);

-- ----------------------------------------------------------------------------
-- 4. 대시보드 / ML / RAG / 알림
-- ----------------------------------------------------------------------------

CREATE TABLE activities (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    actor_id   BIGINT NOT NULL,
    type       VARCHAR(50) NOT NULL,
    target_id  BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    message    TEXT NOT NULL,
    CONSTRAINT fk_activities_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_activities_actor   FOREIGN KEY (actor_id)   REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE activities IS '프로젝트 활동 로그';
COMMENT ON COLUMN activities.type IS '업무 변경/GitHub/회의록/산출물 등';
COMMENT ON COLUMN activities.target_id IS '폴리모픽 대상 id (FK 제약 없음)';
COMMENT ON COLUMN activities.message IS '활동 로그 표시 문구. DEFAULT 없는 NOT NULL — INSERT 시 애플리케이션이 반드시 값을 채워야 함';

CREATE INDEX idx_activities_target ON activities (target_id);

CREATE TABLE ml_predictions (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id   BIGINT NOT NULL,
    model_type  VARCHAR(50) NOT NULL,
    result      VARCHAR(50),
    score       DECIMAL(6,3),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_predictions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE ml_predictions IS 'ML 예측 결과 (지연 위험도/업무 편중/이상치)';
COMMENT ON COLUMN ml_predictions.target_type IS 'task/user (폴리모픽)';
COMMENT ON COLUMN ml_predictions.model_type IS 'delay_risk/overload/anomaly';
COMMENT ON COLUMN ml_predictions.result IS '정상/주의/위험 등';

CREATE TABLE workload_scores (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL,
    user_id        BIGINT NOT NULL,
    overload_score DECIMAL(5,2) NOT NULL,
    anomaly_type   VARCHAR(20) NOT NULL,
    computed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workload_scores_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_workload_scores_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE workload_scores IS 'FS-5 업무 편중 점수 스냅샷 (재계산마다 새 row, contribution_reports와 동일한 이력 저장 방식)';
COMMENT ON COLUMN workload_scores.anomaly_type IS '정상/과부하 의심/저활동 의심/이상 패턴(방향 불명확) 중 하나';

-- document_chunks.embedding: pgvector VECTOR(1024)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL,
    source_type VARCHAR(20) NOT NULL,
    source_id   BIGINT NOT NULL,
    content     TEXT NOT NULL,
    embedding   VECTOR(1024),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_chunks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE document_chunks IS 'RAG 임베딩 청크';
COMMENT ON COLUMN document_chunks.source_type IS 'meeting/task/deliverable/github (폴리모픽)';
COMMENT ON COLUMN document_chunks.embedding IS 'pgvector VECTOR(1024), BAAI/bge-m3 기반 임베딩(쿼리 노이즈 강건성 파인튜닝)';

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_document_chunks_project
  ON document_chunks (project_id, source_type);

CREATE TABLE assistant_messages (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    role       VARCHAR(10) NOT NULL,
    content    TEXT NOT NULL,
    sources    JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_assistant_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_assistant_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE assistant_messages IS 'AI Assistant 대화 이력';
COMMENT ON COLUMN assistant_messages.role IS 'user/assistant';
COMMENT ON COLUMN assistant_messages.sources IS '출처 (회의록/업무/산출물 등)';

CREATE TABLE notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    type       VARCHAR(50) NOT NULL,
    title      VARCHAR(200) NOT NULL,
    content    TEXT,
    target_type VARCHAR(30),
    target_id  BIGINT,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
);
COMMENT ON TABLE notifications IS '사용자 알림';
COMMENT ON COLUMN notifications.target_type IS '폴리모픽 대상 유형 (task/meeting/comment 등)';

CREATE INDEX idx_notifications_user_id ON notifications (user_id);

-- ----------------------------------------------------------------------------
-- 5. 산출물 / GitHub
-- ----------------------------------------------------------------------------

CREATE TABLE deliverables (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    type       VARCHAR(30) NOT NULL,
    title      VARCHAR(200) NOT NULL,
    content    TEXT,
    status     VARCHAR(20) NOT NULL DEFAULT 'draft',
    file_path  VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_deliverables_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE deliverables IS '산출물 초안/결과물';
COMMENT ON COLUMN deliverables.type IS '발표자료/보고서/README/제안서 등';
COMMENT ON COLUMN deliverables.status IS 'draft/review/final';

CREATE TRIGGER trg_deliverables_updated_at
    BEFORE UPDATE ON deliverables
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE github_records (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL,
    type            VARCHAR(20) NOT NULL,
    title           VARCHAR(300) NOT NULL,
    author          VARCHAR(100),
    url             VARCHAR(500),
    linked_task_id  BIGINT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_github_project FOREIGN KEY (project_id)     REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_github_task    FOREIGN KEY (linked_task_id) REFERENCES tasks(id)    ON DELETE SET NULL
);
COMMENT ON TABLE github_records IS 'GitHub 커밋/PR/Issue 동기화 기록';
COMMENT ON COLUMN github_records.type IS 'commit/pr/issue';
COMMENT ON COLUMN github_records.linked_task_id IS '선택적 FK - 업무 연결';

-- ----------------------------------------------------------------------------
-- 6. 심사자 / 기여도 / 평가
-- ----------------------------------------------------------------------------

CREATE TABLE contribution_reports (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    summary    TEXT,
    evidence   JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_contribution_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_contribution_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE contribution_reports IS '심사자 전용 기여도 리포트';
COMMENT ON COLUMN contribution_reports.evidence IS '업무/회의/GitHub/산출물 근거';

CREATE TABLE evaluation_scores (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    score      DECIMAL(5,2) NOT NULL,
    is_public  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_evaluation_scores UNIQUE (project_id, user_id),
    CONSTRAINT fk_scores_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_scores_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE evaluation_scores IS '심사자 최종 평가 점수';

CREATE TRIGGER trg_evaluation_scores_updated_at
    BEFORE UPDATE ON evaluation_scores
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE comments (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL,
    target_type     VARCHAR(10) NOT NULL,
    target_user_id  BIGINT NULL,
    author_id       BIGINT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    target_id       BIGINT,
    CONSTRAINT fk_comments_project     FOREIGN KEY (project_id)     REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_target_user FOREIGN KEY (target_user_id) REFERENCES users(id)    ON DELETE CASCADE,
    CONSTRAINT fk_comments_author      FOREIGN KEY (author_id)      REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE comments IS '개인/팀 코멘트';
COMMENT ON COLUMN comments.target_type IS 'personal/team';
COMMENT ON COLUMN comments.target_user_id IS 'personal일 때만 사용, team이면 NULL';
COMMENT ON COLUMN comments.target_id IS '폴리모픽 대상 id (FK 제약 없음)';

CREATE INDEX idx_comments_target ON comments (target_type, target_id);

CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    action      VARCHAR(50) NOT NULL,
    target_type VARCHAR(30),
    target_id   BIGINT,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
COMMENT ON TABLE audit_logs IS '심사자 조회 등 감사 로그';
