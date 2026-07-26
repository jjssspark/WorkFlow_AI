-- ============================================================================
-- WorkFlow AI - Database Schema (PostgreSQL DDL)
-- 출처: docs/WorkFlow_AI_PRD.md, docs/WorkFlow_AI_API_명세서.md,
--       docs/WorkFlow_AI_7인_구현_상세.md, docs/WorkFlow_AI_Data_Architecture.pptx
-- 스코프: P0+P1+P2 전체 기능 (20개 테이블)
-- 용도: 실제 서비스 스택(PostgreSQL)에 직접 실행 가능한 DDL
-- 요구 버전: PostgreSQL 13+
-- 주의: document_chunks.embedding은 기본값으로 JSONB를 사용한다. pgvector 확장을 설치했다면
--       파일 하단의 대안 DDL(주석 처리됨)로 VECTOR 타입으로 교체할 것(§6.4).
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
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    name          VARCHAR(100) NOT NULL,
    provider      VARCHAR(20)  NOT NULL,
    provider_id   VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    reviewer_status VARCHAR(20),
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_provider UNIQUE (provider, provider_id)
);
COMMENT ON TABLE users IS '사용자';
COMMENT ON COLUMN users.provider IS 'google/local/demo 등 계정 출처';
COMMENT ON COLUMN users.provider_id IS 'OAuth sub 또는 로컬 계정은 email과 동일값 (불변 식별자)';
COMMENT ON COLUMN users.password_hash IS '로컬(이메일/비밀번호) 회원가입 계정만 사용. BCrypt 해시. Google/데모 계정은 NULL.';
COMMENT ON COLUMN users.reviewer_status IS 'REVIEWER로 가입 신청한 계정만 사용: PENDING/APPROVED. NULL이면 심사자 신청 이력 없음.';

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE projects (
    id              BIGSERIAL PRIMARY KEY,
    title           VARCHAR(200) NOT NULL,
    type            VARCHAR(50),
    deadline        DATE,
    description     TEXT,
    start_date      DATE,
    mid_check_date  DATE,
    member_limit    INTEGER,
    deliverables    JSONB,
    tech_stack      JSONB,
    goals           TEXT,
    invite_code     VARCHAR(20),
    created_by      BIGINT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_invite_code UNIQUE (invite_code),
    CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
COMMENT ON TABLE projects IS '프로젝트';
COMMENT ON COLUMN projects.type IS '캡스톤디자인/팀프로젝트/공모전/해커톤/기타';
COMMENT ON COLUMN projects.deadline IS '최종 마감일';
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
    start_date DATE,
    due_date   DATE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE milestones IS '프로젝트 마일스톤';

CREATE TABLE tasks (
    id           BIGSERIAL PRIMARY KEY,
    project_id   BIGINT NOT NULL,
    milestone_id BIGINT NULL,
    title        VARCHAR(200) NOT NULL,
    category     VARCHAR(50)  NOT NULL,
    status       VARCHAR(20)  NOT NULL,
    assignee_id  BIGINT NULL,
    start_date   DATE,
    due_date     DATE,
    priority     VARCHAR(20),
    description  TEXT,
    position     DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tasks_project   FOREIGN KEY (project_id)   REFERENCES projects(id)   ON DELETE CASCADE,
    CONSTRAINT fk_tasks_assignee  FOREIGN KEY (assignee_id)  REFERENCES users(id)      ON DELETE SET NULL,
    CONSTRAINT fk_tasks_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL
);
COMMENT ON TABLE tasks IS '업무 보드 항목';
COMMENT ON COLUMN tasks.category IS '기획/프론트엔드/백엔드/AI-ML 등 18종';
COMMENT ON COLUMN tasks.status IS '할 일/진행 중/보류-블로커/완료';
COMMENT ON COLUMN tasks.assignee_id IS '미배정 가능';
COMMENT ON COLUMN tasks.position IS '같은 status 안에서의 칸반 카드 순서(오름차순). 컬럼 간 값 비교는 하지 않음';

CREATE INDEX idx_tasks_project_milestone ON tasks(project_id, milestone_id);
CREATE INDEX idx_milestones_project_dates ON milestones(project_id, start_date, due_date);

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_checklists (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    title      VARCHAR(200) NOT NULL,
    is_done    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_checklists_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_checklists IS '업무 체크리스트';

-- 업무 코멘트 전용 테이블. §6.6의 comments(개인/팀 코멘트)와는 목적이 달라 분리했다(task_id 없음, target_type 기반).
CREATE TABLE task_comments (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    author_id  BIGINT NOT NULL,
    content    TEXT NOT NULL,
    type       VARCHAR(20) NOT NULL DEFAULT 'COMMENT', -- 'COMMENT' | 'FEEDBACK'(팀장 전용)
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_comments_task   FOREIGN KEY (task_id)   REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_comments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_comments IS '업무 코멘트';
CREATE INDEX idx_task_comments_task ON task_comments (task_id);

CREATE TABLE task_results (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL UNIQUE,
    content    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_results_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
COMMENT ON TABLE task_results IS '업무당 1개, 작업 내용 작성 upsert';

CREATE TRIGGER trg_task_results_updated_at
    BEFORE UPDATE ON task_results
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_result_links (
    id         BIGSERIAL PRIMARY KEY,
    task_id    BIGINT NOT NULL,
    url        TEXT NOT NULL,
    title      VARCHAR(200) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_result_links_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX idx_task_result_links_task ON task_result_links (task_id);

CREATE TABLE task_result_files (
    id           BIGSERIAL PRIMARY KEY,
    task_id      BIGINT NOT NULL,
    file_name    VARCHAR(255) NOT NULL,
    storage_path TEXT NOT NULL, -- Supabase Storage 내 object 경로 (버킷 하위)
    size         BIGINT NOT NULL,
    content_type VARCHAR(100),
    uploaded_by  BIGINT,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_task_result_files_task     FOREIGN KEY (task_id)     REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_result_files_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_task_result_files_task ON task_result_files (task_id);

-- ----------------------------------------------------------------------------
-- 3. 회의록 AI
-- ----------------------------------------------------------------------------

CREATE TABLE meetings (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL,
    title           VARCHAR(200),
    file_type       VARCHAR(20) NOT NULL,
    file_path       VARCHAR(500),
    transcript      TEXT,
    analysis_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    analysis_job_id UUID,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_meetings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
COMMENT ON TABLE meetings IS '회의록/녹음 업로드';
COMMENT ON COLUMN meetings.file_type IS 'document/audio';
COMMENT ON COLUMN meetings.analysis_status IS '비동기 분석 상태';
COMMENT ON COLUMN meetings.analysis_job_id IS '현재 Redis Stream 분석 작업의 세대 식별자';

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
    meeting_id   BIGINT PRIMARY KEY,
    summary      TEXT,
    decisions    JSONB,
    risks        JSONB,
    action_items JSONB,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_analysis_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
COMMENT ON TABLE meeting_analysis IS '회의록 AI 분석 결과';
COMMENT ON COLUMN meeting_analysis.meeting_id IS '1:1 - meetings.id';
COMMENT ON COLUMN meeting_analysis.decisions IS '결정사항 목록';
COMMENT ON COLUMN meeting_analysis.risks IS '위험요소 목록';
COMMENT ON COLUMN meeting_analysis.action_items IS 'To-Do 후보 목록';

-- ----------------------------------------------------------------------------
-- 4. 대시보드 / ML / RAG
-- ----------------------------------------------------------------------------

CREATE TABLE activities (
    id         BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL,
    actor_id   BIGINT NOT NULL,
    type       VARCHAR(50) NOT NULL,
    target_id  BIGINT,
    message    TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activities_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_activities_actor   FOREIGN KEY (actor_id)   REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE activities IS '프로젝트 활동 로그';
COMMENT ON COLUMN activities.type IS '업무 변경/GitHub/회의록/산출물 등';
COMMENT ON COLUMN activities.target_id IS '폴리모픽 대상 id (FK 제약 없음). 현재는 업무(task) id만 씀';
COMMENT ON COLUMN activities.message IS '화면에 그대로 보여줄 사람이 읽는 메시지';
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

-- document_chunks.embedding: 기본값은 JSONB. pgvector 확장 사용 시 파일 하단 대안 참고.
CREATE TABLE document_chunks (
    id          BIGSERIAL PRIMARY KEY,
    project_id  BIGINT NOT NULL,
    source_type VARCHAR(20) NOT NULL,
    source_id   BIGINT NOT NULL,
    content     TEXT NOT NULL,
    embedding   JSONB,
    assignee_id BIGINT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_chunks_project  FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_chunks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id)    ON DELETE SET NULL
);
COMMENT ON TABLE document_chunks IS 'RAG 임베딩 청크';
COMMENT ON COLUMN document_chunks.source_type IS 'meeting/task/deliverable/github (폴리모픽)';
COMMENT ON COLUMN document_chunks.embedding IS 'pgvector 미사용 시 JSONB로 임시 표현 (§6.4 참고)';
COMMENT ON COLUMN document_chunks.assignee_id IS 'task/action_item 담당자 (RAG 질의 개인화용, 없으면 NULL)';

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
    CONSTRAINT fk_comments_project     FOREIGN KEY (project_id)     REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_target_user FOREIGN KEY (target_user_id) REFERENCES users(id)    ON DELETE CASCADE,
    CONSTRAINT fk_comments_author      FOREIGN KEY (author_id)      REFERENCES users(id)    ON DELETE CASCADE
);
COMMENT ON TABLE comments IS '개인/팀 코멘트';
COMMENT ON COLUMN comments.target_type IS 'personal/team';
COMMENT ON COLUMN comments.target_user_id IS 'personal일 때만 사용, team이면 NULL';

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

-- ============================================================================
-- (선택) pgvector 대안: document_chunks.embedding을 실제 벡터 타입으로 쓰려면
-- 아래 순서로 위 document_chunks 정의 대신 사용할 것.
--
-- CREATE EXTENSION IF NOT EXISTS vector;
-- CREATE TABLE document_chunks (
--     id          BIGSERIAL PRIMARY KEY,
--     project_id  BIGINT NOT NULL,
--     source_type VARCHAR(20) NOT NULL,
--     source_id   BIGINT NOT NULL,
--     content     TEXT NOT NULL,
--     embedding   VECTOR(1536),  -- 임베딩 모델 차원 수에 맞게 조정 (운영은 bge-m3라 1024)
--     assignee_id BIGINT NULL,   -- task/action_item 담당자 (RAG 질의 개인화용)
--     created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT fk_chunks_project  FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
--     CONSTRAINT fk_chunks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id)    ON DELETE SET NULL
-- );
-- ============================================================================
