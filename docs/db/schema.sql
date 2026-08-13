--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10 (Debian 17.10-1.pgdg12+1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    actor_id bigint NOT NULL,
    type character varying(50) NOT NULL,
    target_id bigint,
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE activities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.activities IS '프로젝트 활동 로그';


--
-- Name: COLUMN activities.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.type IS '업무 변경/GitHub/회의록/산출물 등';


--
-- Name: COLUMN activities.target_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.target_id IS '폴리모픽 대상 id (FK 제약 없음). 현재는 업무(task) id만 씀';


--
-- Name: COLUMN activities.message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activities.message IS '화면에 그대로 보여줄 사람이 읽는 메시지';


--
-- Name: activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activities_id_seq OWNED BY public.activities.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    action character varying(50) NOT NULL,
    target_type character varying(30),
    target_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS '심사자 조회 등 감사 로그';


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    target_type character varying(10) NOT NULL,
    target_user_id bigint,
    author_id bigint NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    target_id bigint,
    parent_id bigint
);


--
-- Name: TABLE comments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.comments IS '개인/팀 코멘트';


--
-- Name: COLUMN comments.target_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comments.target_type IS 'personal/team';


--
-- Name: COLUMN comments.target_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comments.target_user_id IS 'personal일 때만 사용, team이면 NULL';


--
-- Name: COLUMN comments.target_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.comments.target_id IS 'target_type에 따른 대상 id (폴리모픽, FK 제약 없음)';


--
-- Name: comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comments_id_seq OWNED BY public.comments.id;


--
-- Name: contribution_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contribution_reports (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    user_id bigint NOT NULL,
    summary text,
    evidence jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE contribution_reports; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contribution_reports IS '심사자 전용 기여도 리포트';


--
-- Name: COLUMN contribution_reports.evidence; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contribution_reports.evidence IS '업무/회의/GitHub/산출물 근거';


--
-- Name: contribution_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contribution_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contribution_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contribution_reports_id_seq OWNED BY public.contribution_reports.id;


--
-- Name: deliverables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverables (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    type character varying(30) NOT NULL,
    title character varying(200) NOT NULL,
    content text,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    file_path character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE deliverables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deliverables IS '산출물 초안/결과물';


--
-- Name: COLUMN deliverables.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deliverables.type IS '발표자료/보고서/README/제안서 등';


--
-- Name: COLUMN deliverables.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.deliverables.status IS 'draft/review/final';


--
-- Name: deliverables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deliverables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deliverables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deliverables_id_seq OWNED BY public.deliverables.id;


--
-- Name: document_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_chunks (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    source_type character varying(20) NOT NULL,
    source_id bigint NOT NULL,
    content text NOT NULL,
    embedding public.vector(1024),
    assignee_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE document_chunks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_chunks IS 'RAG 임베딩 청크';


--
-- Name: COLUMN document_chunks.source_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document_chunks.source_type IS 'meeting/task/deliverable/github (폴리모픽)';


--
-- Name: COLUMN document_chunks.embedding; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document_chunks.embedding IS 'pgvector 미사용 시 JSONB로 임시 표현 (§6.4 참고)';


--
-- Name: COLUMN document_chunks.assignee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document_chunks.assignee_id IS 'task/action_item 담당자 (RAG 질의 개인화용, 없으면 NULL)';


--
-- Name: document_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_chunks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_chunks_id_seq OWNED BY public.document_chunks.id;


--
-- Name: evaluation_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_scores (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    user_id bigint NOT NULL,
    score numeric(5,2) NOT NULL,
    contribution_public boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reviewer_score numeric(5,2),
    grade character varying(2),
    final_public boolean DEFAULT false NOT NULL,
    comment_public boolean DEFAULT false NOT NULL,
    comment text,
    total_score numeric(5,2),
    CONSTRAINT chk_evaluation_scores_grade CHECK (((grade IS NULL) OR ((grade)::text = ANY ((ARRAY['A+'::character varying, 'A'::character varying, 'A0'::character varying, 'A-'::character varying, 'B+'::character varying, 'B'::character varying, 'B0'::character varying, 'B-'::character varying, 'C+'::character varying, 'C'::character varying, 'C0'::character varying, 'C-'::character varying, 'D+'::character varying, 'D'::character varying, 'D0'::character varying, 'D-'::character varying, 'F'::character varying, 'P'::character varying, 'NP'::character varying])::text[]))))
);


--
-- Name: TABLE evaluation_scores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.evaluation_scores IS '심사자 최종 평가 점수';


--
-- Name: COLUMN evaluation_scores.score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.score IS 'AI가 산정한 기여 점수(기여도 분석 화면 왼쪽 테이블 값)';


--
-- Name: COLUMN evaluation_scores.contribution_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.contribution_public IS '기여 점수(왼쪽 기여도 테이블) 공개 여부';


--
-- Name: COLUMN evaluation_scores.reviewer_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.reviewer_score IS '심사자가 학점 계산기에서 직접 입력한 심사자 점수(0~100)';


--
-- Name: COLUMN evaluation_scores.grade; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.grade IS '학점(A+/A/A0/A-/B+/B/B0/B-/C+/C/C0/C-/D+/D/D0/D-/F/P/NP)';


--
-- Name: COLUMN evaluation_scores.final_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.final_public IS '학점 계산기 총합/심사자 점수/학점 공개 여부';


--
-- Name: COLUMN evaluation_scores.comment_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.comment_public IS '심사 코멘트 공개 여부';


--
-- Name: COLUMN evaluation_scores.comment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.comment IS '심사자가 팀원에게 남기는 평가 코멘트';


--
-- Name: COLUMN evaluation_scores.total_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_scores.total_score IS '학점 계산기가 계산해 저장한 최종 총합(기여 점수×비율 + 심사자 점수×비율)';


--
-- Name: evaluation_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.evaluation_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evaluation_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evaluation_scores_id_seq OWNED BY public.evaluation_scores.id;


--
-- Name: evaluation_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_settings (
    project_id bigint NOT NULL,
    contribution_ratio numeric(5,2) DEFAULT 40.00 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE evaluation_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.evaluation_settings IS '프로젝트별 학점 계산기 점수 비율 설정';


--
-- Name: COLUMN evaluation_settings.contribution_ratio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluation_settings.contribution_ratio IS '기여 점수 반영 비율(%, 0~100). 심사자 점수 비율은 100에서 뺀 값으로 자동 계산';


--
-- Name: flyway_schema_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flyway_schema_history (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: github_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.github_records (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    type character varying(20) NOT NULL,
    title character varying(300) NOT NULL,
    author character varying(100),
    url character varying(500),
    linked_task_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE github_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.github_records IS 'GitHub 커밋/PR/Issue 동기화 기록';


--
-- Name: COLUMN github_records.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.github_records.type IS 'commit/pr/issue';


--
-- Name: COLUMN github_records.linked_task_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.github_records.linked_task_id IS '선택적 FK - 업무 연결';


--
-- Name: github_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.github_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: github_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.github_records_id_seq OWNED BY public.github_records.id;


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    email character varying(255),
    role character varying(20) NOT NULL,
    token character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE invitations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.invitations IS '팀원/심사자 초대';


--
-- Name: COLUMN invitations.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invitations.email IS '이메일 지정 초대의 대상. 링크 복사로 발급된 초대는 대상이 없어 NULL';


--
-- Name: COLUMN invitations.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.invitations.status IS 'pending/accepted/expired';


--
-- Name: invitations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invitations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invitations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invitations_id_seq OWNED BY public.invitations.id;


--
-- Name: meeting_action_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_action_items (
    id bigint NOT NULL,
    meeting_id bigint,
    title character varying NOT NULL,
    description text,
    category character varying,
    recommended_assignee_id bigint,
    final_assignee_id bigint,
    due_date date,
    priority character varying,
    basis text,
    approved boolean DEFAULT false NOT NULL,
    created_task_id bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE meeting_action_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meeting_action_items IS '회의록 AI To-Do 후보 (승인 전/후 상태 및 등록된 업무 추적)';


--
-- Name: COLUMN meeting_action_items.recommended_assignee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_action_items.recommended_assignee_id IS 'AI가 추천한 담당자 (이름 매칭으로 해석된 user id)';


--
-- Name: COLUMN meeting_action_items.basis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_action_items.basis IS '업무 생성 근거';


--
-- Name: COLUMN meeting_action_items.approved; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_action_items.approved IS '팀장 승인 여부';


--
-- Name: COLUMN meeting_action_items.created_task_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_action_items.created_task_id IS '팀장 승인 후 등록된 실제 업무 (중복 등록 방지 기준)';


--
-- Name: meeting_action_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.meeting_action_items ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.meeting_action_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: meeting_analysis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_analysis (
    meeting_id bigint NOT NULL,
    summary text,
    decisions jsonb,
    risks jsonb,
    action_items jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    analysis_engine character varying,
    keywords jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: TABLE meeting_analysis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meeting_analysis IS '회의록 AI 분석 결과';


--
-- Name: COLUMN meeting_analysis.meeting_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_analysis.meeting_id IS '1:1 - meetings.id';


--
-- Name: COLUMN meeting_analysis.decisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_analysis.decisions IS '결정사항 목록';


--
-- Name: COLUMN meeting_analysis.risks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_analysis.risks IS '위험요소 목록';


--
-- Name: COLUMN meeting_analysis.action_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_analysis.action_items IS 'To-Do 후보 목록';


--
-- Name: COLUMN meeting_analysis.analysis_engine; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_analysis.analysis_engine IS 'FASTAPI/SPRING_FALLBACK';


--
-- Name: COLUMN meeting_analysis.keywords; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meeting_analysis.keywords IS 'AI가 추출한 핵심 키워드 목록';


--
-- Name: meeting_attendees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_attendees (
    id bigint NOT NULL,
    meeting_id bigint NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: TABLE meeting_attendees; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meeting_attendees IS '회의 참석자 태깅 (기여도 근거로도 사용)';


--
-- Name: meeting_attendees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meeting_attendees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meeting_attendees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meeting_attendees_id_seq OWNED BY public.meeting_attendees.id;


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    title character varying(200),
    file_type character varying(20) NOT NULL,
    file_path character varying(500),
    transcript text,
    analysis_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    analysis_job_id uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    meeting_date date,
    meeting_type character varying,
    original_file_name character varying,
    uploaded_by bigint,
    file_size bigint,
    original_meeting_id bigint,
    edited_by bigint,
    saved_at timestamp without time zone
);


--
-- Name: TABLE meetings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.meetings IS '회의록/녹음 업로드';


--
-- Name: COLUMN meetings.file_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.file_type IS 'document/audio';


--
-- Name: COLUMN meetings.analysis_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.analysis_status IS '비동기 분석 상태';


--
-- Name: COLUMN meetings.analysis_job_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.analysis_job_id IS '현재 Redis Stream 분석 작업의 세대 식별자';


--
-- Name: COLUMN meetings.meeting_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.meeting_date IS '회의 날짜 (분석 요청 시 입력)';


--
-- Name: COLUMN meetings.meeting_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.meeting_type IS '정기회의/중간점검/발표준비 등';


--
-- Name: COLUMN meetings.original_file_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.original_file_name IS '업로드 원본 파일명';


--
-- Name: COLUMN meetings.uploaded_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.uploaded_by IS '업로드한 사용자';


--
-- Name: COLUMN meetings.file_size; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.file_size IS '업로드 파일 크기(byte)';


--
-- Name: COLUMN meetings.original_meeting_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.original_meeting_id IS '이 레코드가 수정본이면 원본 회의록 id (원본 자신은 NULL)';


--
-- Name: COLUMN meetings.edited_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.edited_by IS '이 버전을 수정/생성한 사용자 (원본에는 NULL)';


--
-- Name: COLUMN meetings.saved_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.meetings.saved_at IS '분석결과 저장 확정 또는 수정본 저장 시각 (NULL이면 아직 저장 확정 전)';


--
-- Name: meetings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meetings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meetings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meetings_id_seq OWNED BY public.meetings.id;


--
-- Name: milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestones (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    start_date date,
    due_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE milestones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.milestones IS '프로젝트 마일스톤';


--
-- Name: milestones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.milestones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: milestones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.milestones_id_seq OWNED BY public.milestones.id;


--
-- Name: ml_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_predictions (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    target_type character varying(20) NOT NULL,
    target_id bigint NOT NULL,
    model_type character varying(50) NOT NULL,
    result character varying(50),
    score numeric(6,3),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE ml_predictions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ml_predictions IS 'ML 예측 결과 (지연 위험도/업무 편중/이상치)';


--
-- Name: COLUMN ml_predictions.target_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_predictions.target_type IS 'task/user (폴리모픽)';


--
-- Name: COLUMN ml_predictions.model_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_predictions.model_type IS 'delay_risk/overload/anomaly';


--
-- Name: COLUMN ml_predictions.result; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ml_predictions.result IS '정상/주의/위험 등';


--
-- Name: ml_predictions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ml_predictions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ml_predictions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ml_predictions_id_seq OWNED BY public.ml_predictions.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    type character varying NOT NULL,
    title character varying NOT NULL,
    content text,
    target_type character varying,
    target_id bigint,
    project_id bigint,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS '사용자 알림 (업무 배정, 코멘트 등)';


--
-- Name: COLUMN notifications.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.type IS '알림 종류 (예: TASK_ASSIGNED)';


--
-- Name: COLUMN notifications.target_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.target_type IS '알림이 가리키는 대상 종류 (예: task)';


--
-- Name: COLUMN notifications.target_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.target_id IS '대상 id (예: task id, 폴리모픽, FK 제약 없음)';


--
-- Name: COLUMN notifications.project_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.project_id IS '알림을 분리해서 표시할 프로젝트 id';


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    user_id bigint NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_accessed_at timestamp without time zone
);


--
-- Name: TABLE project_members; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.project_members IS '프로젝트 멤버십/역할';


--
-- Name: COLUMN project_members.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.project_members.role IS '팀장/팀원/심사자 (프로젝트별 role)';


--
-- Name: project_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_members_id_seq OWNED BY public.project_members.id;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id bigint NOT NULL,
    title character varying(200) NOT NULL,
    type character varying(50),
    deadline date,
    description text,
    start_date date,
    mid_check_date date,
    member_limit integer,
    deliverables jsonb,
    tech_stack jsonb,
    goals text,
    invite_code character varying(20),
    created_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    eval_status character varying(20) DEFAULT 'EVALUATING'::character varying NOT NULL,
    year integer,
    CONSTRAINT chk_projects_eval_status CHECK (((eval_status)::text = ANY ((ARRAY['PENDING'::character varying, 'EVALUATING'::character varying, 'PUBLISHED'::character varying])::text[])))
);


--
-- Name: TABLE projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.projects IS '프로젝트';


--
-- Name: COLUMN projects.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.type IS '캡스톤디자인/팀프로젝트/공모전/해커톤/기타';


--
-- Name: COLUMN projects.deadline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.deadline IS '최종 마감일';


--
-- Name: COLUMN projects.mid_check_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.mid_check_date IS '중간 점검/중간보고일 (선택)';


--
-- Name: COLUMN projects.member_limit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.member_limit IS '예상 참여 인원 수';


--
-- Name: COLUMN projects.deliverables; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.deliverables IS '목표 산출물 목록 (예: ["발표자료","보고서"])';


--
-- Name: COLUMN projects.tech_stack; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.tech_stack IS '기술 스택/주요 기능 키워드 목록';


--
-- Name: COLUMN projects.goals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.goals IS '진행 목표/간단 메모';


--
-- Name: COLUMN projects.invite_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.invite_code IS '초대 코드 (온보딩 시 자동 생성)';


--
-- Name: COLUMN projects.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.created_by IS '생성자 user id';


--
-- Name: COLUMN projects.eval_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.projects.eval_status IS '심사자 평가 상태: PENDING/EVALUATING/PUBLISHED (chk_projects_eval_status로 제한)';


--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: rag_assignee_sync_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rag_assignee_sync_failures (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id bigint NOT NULL,
    assignee_id bigint,
    error_message text,
    failed_at timestamp without time zone NOT NULL
);


--
-- Name: TABLE rag_assignee_sync_failures; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rag_assignee_sync_failures IS 'RAG 인덱싱 시 담당자(assignee) 동기화에 실패한 이력';


--
-- Name: rag_assignee_sync_failures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rag_assignee_sync_failures_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rag_assignee_sync_failures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rag_assignee_sync_failures_id_seq OWNED BY public.rag_assignee_sync_failures.id;


--
-- Name: reviewer_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviewer_activities (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    project_id bigint NOT NULL,
    activity_type character varying(40) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reviewer_activities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reviewer_activities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reviewer_activities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reviewer_activities_id_seq OWNED BY public.reviewer_activities.id;


--
-- Name: task_checklists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_checklists (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    is_done boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE task_checklists; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.task_checklists IS '업무 체크리스트';


--
-- Name: task_checklists_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_checklists_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_checklists_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_checklists_id_seq OWNED BY public.task_checklists.id;


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    author_id bigint NOT NULL,
    content text NOT NULL,
    type character varying(20) DEFAULT 'COMMENT'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE task_comments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.task_comments IS '업무 코멘트';


--
-- Name: task_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_comments_id_seq OWNED BY public.task_comments.id;


--
-- Name: task_result_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_result_files (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    file_name character varying(255) NOT NULL,
    storage_path text NOT NULL,
    size bigint NOT NULL,
    content_type character varying(100),
    uploaded_by bigint,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: task_result_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_result_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_result_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_result_files_id_seq OWNED BY public.task_result_files.id;


--
-- Name: task_result_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_result_links (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    url text NOT NULL,
    title character varying(200) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: task_result_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_result_links_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_result_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_result_links_id_seq OWNED BY public.task_result_links.id;


--
-- Name: task_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_results (
    id bigint NOT NULL,
    task_id bigint NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE task_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.task_results IS '업무당 1개, 작업 내용 작성 upsert';


--
-- Name: task_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_results_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_results_id_seq OWNED BY public.task_results.id;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    milestone_id bigint,
    title character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    assignee_id bigint,
    start_date date,
    due_date date,
    done_date date,
    priority character varying(20),
    description text,
    "position" double precision NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_type character varying,
    source_meeting_id bigint,
    created_by bigint,
    pending_approval boolean DEFAULT false NOT NULL,
    extra_fields jsonb,
    move_version bigint DEFAULT 0 NOT NULL
);


--
-- Name: TABLE tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tasks IS '업무 보드 항목';


--
-- Name: COLUMN tasks.category; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.category IS '기획/프론트엔드/백엔드/AI-ML 등 18종';


--
-- Name: COLUMN tasks.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.status IS '할 일/진행 중/보류-블로커/완료';


--
-- Name: COLUMN tasks.assignee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.assignee_id IS '미배정 가능';


--
-- Name: COLUMN tasks.start_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.start_date IS '업무 시작일 (선택, 마감일보다 뒤일 수 없음)';


--
-- Name: COLUMN tasks."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks."position" IS '같은 status 안에서의 칸반 카드 순서(오름차순). 컬럼 간 값 비교는 하지 않음';


--
-- Name: COLUMN tasks.source_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.source_type IS 'MEETING_AI/MANUAL 등 업무 생성 출처';


--
-- Name: COLUMN tasks.source_meeting_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.source_meeting_id IS '회의록 AI로 생성된 경우 원본 회의록';


--
-- Name: COLUMN tasks.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.created_by IS '업무를 실제로 등록한 사용자(팀장 승인자)';


--
-- Name: COLUMN tasks.pending_approval; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.pending_approval IS '팀원이 완료 이동을 요청했고 아직 팀장 승인/반려 전인 상태';


--
-- Name: COLUMN tasks.extra_fields; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.extra_fields IS '카테고리별 추가 정보(자유 키-값). AddTaskModal/EditTaskModal의 카테고리 전용 입력값을 저장';


--
-- Name: COLUMN tasks.move_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.move_version IS '출처 불명. 운영에만 있던 컬럼을 정합화 목적으로 편입했다. 앱 코드에서 참조하지 않음';


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    provider character varying(20) NOT NULL,
    provider_id character varying(255) NOT NULL,
    password_hash character varying(255),
    reviewer_status character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    affiliation character varying(100),
    field_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    github_username character varying(100),
    profile_image_path character varying(255),
    terms_agreed_at timestamp without time zone,
    privacy_agreed_at timestamp without time zone,
    is_admin boolean DEFAULT false NOT NULL,
    faculty_id character varying(50),
    reviewer_rejection_reason character varying(500)
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS '사용자';


--
-- Name: COLUMN users.provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.provider IS 'google/local/demo 등 계정 출처';


--
-- Name: COLUMN users.provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.provider_id IS 'OAuth sub 또는 로컬 계정은 email과 동일값 (불변 식별자)';


--
-- Name: COLUMN users.password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.password_hash IS '로컬(이메일/비밀번호) 회원가입 계정만 사용. BCrypt 해시. Google/데모 계정은 NULL.';


--
-- Name: COLUMN users.reviewer_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.reviewer_status IS 'REVIEWER로 가입 신청한 계정만 사용: PENDING(승인 대기)/APPROVED(승인 완료)/REJECTED(거부, 재신청 전까지 로그인 차단). NULL이면 심사자 신청 이력 없음.';


--
-- Name: COLUMN users.affiliation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.affiliation IS '소속 (예: 컴퓨터공학과 3학년)';


--
-- Name: COLUMN users.field_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.field_tags IS '전공/관심 분야 태그 배열 (예: ["백엔드", "인프라"])';


--
-- Name: COLUMN users.github_username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.github_username IS 'GitHub 아이디만 저장한다 (URL 아님)';


--
-- Name: COLUMN users.profile_image_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.profile_image_path IS 'Supabase Storage 내 프로필 사진 오브젝트 경로 (avatars/{userId}/...)';


--
-- Name: COLUMN users.terms_agreed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.terms_agreed_at IS '이메일/비밀번호 회원가입 시 이용약관에 동의한 시각. Google OAuth/데모 계정은 NULL';


--
-- Name: COLUMN users.privacy_agreed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.privacy_agreed_at IS '이메일/비밀번호 회원가입 시 개인정보처리방침에 동의한 시각. Google OAuth/데모 계정은 NULL';


--
-- Name: COLUMN users.is_admin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.is_admin IS '전역 관리자 여부. 최초 관리자는 운영자가 DB에서 직접 UPDATE로 지정한다.';


--
-- Name: COLUMN users.faculty_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.faculty_id IS '심사자(REVIEWER) 신청 시 입력하는 교수/교직원 식별번호. 민감정보 — 본인/관리자만 조회, 일반 응답에는 포함하지 않는다.';


--
-- Name: COLUMN users.reviewer_rejection_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.reviewer_rejection_reason IS '관리자가 심사자 신청을 거부할 때 남기는 사유.';


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: workload_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workload_scores (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    user_id bigint NOT NULL,
    overload_score numeric(5,2) NOT NULL,
    anomaly_type character varying(20) NOT NULL,
    computed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TABLE workload_scores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workload_scores IS 'FS-5 업무 편중 점수 스냅샷 (재계산마다 새 row, contribution_reports와 동일한 이력 저장 방식)';


--
-- Name: COLUMN workload_scores.anomaly_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workload_scores.anomaly_type IS '정상/과부하 의심/저활동 의심/이상 패턴(방향 불명확) 중 하나';


--
-- Name: workload_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workload_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workload_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workload_scores_id_seq OWNED BY public.workload_scores.id;


--
-- Name: activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities ALTER COLUMN id SET DEFAULT nextval('public.activities_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments ALTER COLUMN id SET DEFAULT nextval('public.comments_id_seq'::regclass);


--
-- Name: contribution_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribution_reports ALTER COLUMN id SET DEFAULT nextval('public.contribution_reports_id_seq'::regclass);


--
-- Name: deliverables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables ALTER COLUMN id SET DEFAULT nextval('public.deliverables_id_seq'::regclass);


--
-- Name: document_chunks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks ALTER COLUMN id SET DEFAULT nextval('public.document_chunks_id_seq'::regclass);


--
-- Name: evaluation_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_scores ALTER COLUMN id SET DEFAULT nextval('public.evaluation_scores_id_seq'::regclass);


--
-- Name: github_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_records ALTER COLUMN id SET DEFAULT nextval('public.github_records_id_seq'::regclass);


--
-- Name: invitations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations ALTER COLUMN id SET DEFAULT nextval('public.invitations_id_seq'::regclass);


--
-- Name: meeting_attendees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees ALTER COLUMN id SET DEFAULT nextval('public.meeting_attendees_id_seq'::regclass);


--
-- Name: meetings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings ALTER COLUMN id SET DEFAULT nextval('public.meetings_id_seq'::regclass);


--
-- Name: milestones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones ALTER COLUMN id SET DEFAULT nextval('public.milestones_id_seq'::regclass);


--
-- Name: ml_predictions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions ALTER COLUMN id SET DEFAULT nextval('public.ml_predictions_id_seq'::regclass);


--
-- Name: project_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members ALTER COLUMN id SET DEFAULT nextval('public.project_members_id_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: rag_assignee_sync_failures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_assignee_sync_failures ALTER COLUMN id SET DEFAULT nextval('public.rag_assignee_sync_failures_id_seq'::regclass);


--
-- Name: reviewer_activities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviewer_activities ALTER COLUMN id SET DEFAULT nextval('public.reviewer_activities_id_seq'::regclass);


--
-- Name: task_checklists id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_checklists ALTER COLUMN id SET DEFAULT nextval('public.task_checklists_id_seq'::regclass);


--
-- Name: task_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments ALTER COLUMN id SET DEFAULT nextval('public.task_comments_id_seq'::regclass);


--
-- Name: task_result_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_files ALTER COLUMN id SET DEFAULT nextval('public.task_result_files_id_seq'::regclass);


--
-- Name: task_result_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_links ALTER COLUMN id SET DEFAULT nextval('public.task_result_links_id_seq'::regclass);


--
-- Name: task_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results ALTER COLUMN id SET DEFAULT nextval('public.task_results_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: workload_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workload_scores ALTER COLUMN id SET DEFAULT nextval('public.workload_scores_id_seq'::regclass);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: contribution_reports contribution_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribution_reports
    ADD CONSTRAINT contribution_reports_pkey PRIMARY KEY (id);


--
-- Name: deliverables deliverables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_pkey PRIMARY KEY (id);


--
-- Name: document_chunks document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);


--
-- Name: evaluation_scores evaluation_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT evaluation_scores_pkey PRIMARY KEY (id);


--
-- Name: evaluation_settings evaluation_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_settings
    ADD CONSTRAINT evaluation_settings_pkey PRIMARY KEY (project_id);


--
-- Name: flyway_schema_history flyway_schema_history_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flyway_schema_history
    ADD CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank);


--
-- Name: github_records github_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_records
    ADD CONSTRAINT github_records_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: meeting_action_items meeting_action_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_action_items
    ADD CONSTRAINT meeting_action_items_pkey PRIMARY KEY (id);


--
-- Name: meeting_analysis meeting_analysis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_analysis
    ADD CONSTRAINT meeting_analysis_pkey PRIMARY KEY (meeting_id);


--
-- Name: meeting_attendees meeting_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT meeting_attendees_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: milestones milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_pkey PRIMARY KEY (id);


--
-- Name: ml_predictions ml_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT ml_predictions_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: rag_assignee_sync_failures rag_assignee_sync_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_assignee_sync_failures
    ADD CONSTRAINT rag_assignee_sync_failures_pkey PRIMARY KEY (id);


--
-- Name: reviewer_activities reviewer_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviewer_activities
    ADD CONSTRAINT reviewer_activities_pkey PRIMARY KEY (id);


--
-- Name: task_checklists task_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_checklists
    ADD CONSTRAINT task_checklists_pkey PRIMARY KEY (id);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: task_result_files task_result_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_files
    ADD CONSTRAINT task_result_files_pkey PRIMARY KEY (id);


--
-- Name: task_result_links task_result_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_links
    ADD CONSTRAINT task_result_links_pkey PRIMARY KEY (id);


--
-- Name: task_results task_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results
    ADD CONSTRAINT task_results_pkey PRIMARY KEY (id);


--
-- Name: task_results task_results_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results
    ADD CONSTRAINT task_results_task_id_key UNIQUE (task_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: meeting_action_items uq_action_items_created_task; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_action_items
    ADD CONSTRAINT uq_action_items_created_task UNIQUE (created_task_id);


--
-- Name: evaluation_scores uq_evaluation_scores; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT uq_evaluation_scores UNIQUE (project_id, user_id);


--
-- Name: invitations uq_invitations_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT uq_invitations_token UNIQUE (token);


--
-- Name: meeting_attendees uq_meeting_attendees; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT uq_meeting_attendees UNIQUE (meeting_id, user_id);


--
-- Name: project_members uq_project_members; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT uq_project_members UNIQUE (project_id, user_id);


--
-- Name: projects uq_projects_invite_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uq_projects_invite_code UNIQUE (invite_code);


--
-- Name: users uq_users_email; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_email UNIQUE (email);


--
-- Name: users uq_users_provider; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_provider UNIQUE (provider, provider_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workload_scores workload_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workload_scores
    ADD CONSTRAINT workload_scores_pkey PRIMARY KEY (id);


--
-- Name: flyway_schema_history_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX flyway_schema_history_s_idx ON public.flyway_schema_history USING btree (success);


--
-- Name: idx_activities_actor_type_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_actor_type_created ON public.activities USING btree (actor_id, type, created_at DESC);


--
-- Name: idx_activities_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_target ON public.activities USING btree (target_id);


--
-- Name: idx_comments_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_target ON public.comments USING btree (target_type, target_id);


--
-- Name: idx_document_chunks_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_chunks_project ON public.document_chunks USING btree (project_id, source_type);


--
-- Name: idx_document_chunks_project_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_chunks_project_assignee ON public.document_chunks USING btree (project_id, assignee_id) WHERE (assignee_id IS NOT NULL);


--
-- Name: idx_meeting_action_items_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meeting_action_items_meeting_id ON public.meeting_action_items USING btree (meeting_id);


--
-- Name: idx_meetings_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_project_id ON public.meetings USING btree (project_id);


--
-- Name: idx_milestones_project_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_milestones_project_dates ON public.milestones USING btree (project_id, start_date, due_date);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_notifications_user_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_project_created ON public.notifications USING btree (user_id, project_id, created_at DESC);


--
-- Name: idx_reviewer_activities_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviewer_activities_user_created ON public.reviewer_activities USING btree (user_id, created_at DESC);


--
-- Name: idx_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_task ON public.task_comments USING btree (task_id);


--
-- Name: idx_task_result_files_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_result_files_task ON public.task_result_files USING btree (task_id);


--
-- Name: idx_task_result_links_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_result_links_task ON public.task_result_links USING btree (task_id);


--
-- Name: idx_tasks_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_project_id ON public.tasks USING btree (project_id);


--
-- Name: idx_tasks_project_milestone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_project_milestone ON public.tasks USING btree (project_id, milestone_id);


--
-- Name: idx_tasks_source_meeting_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_source_meeting_id ON public.tasks USING btree (source_meeting_id);


--
-- Name: uq_meetings_original_id_title; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_meetings_original_id_title ON public.meetings USING btree (original_meeting_id, title) WHERE (original_meeting_id IS NOT NULL);


--
-- Name: ux_comments_one_reply_per_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_comments_one_reply_per_parent ON public.comments USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: deliverables trg_deliverables_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deliverables_updated_at BEFORE UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: evaluation_scores trg_evaluation_scores_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evaluation_scores_updated_at BEFORE UPDATE ON public.evaluation_scores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: evaluation_settings trg_evaluation_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_evaluation_settings_updated_at BEFORE UPDATE ON public.evaluation_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: projects trg_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_results trg_task_results_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_results_updated_at BEFORE UPDATE ON public.task_results FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks trg_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: comments comments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: document_chunks document_chunks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meeting_action_items fk_action_items_created_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_action_items
    ADD CONSTRAINT fk_action_items_created_task FOREIGN KEY (created_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: meeting_action_items fk_action_items_final_assignee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_action_items
    ADD CONSTRAINT fk_action_items_final_assignee FOREIGN KEY (final_assignee_id) REFERENCES public.users(id);


--
-- Name: meeting_action_items fk_action_items_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_action_items
    ADD CONSTRAINT fk_action_items_meeting FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: meeting_action_items fk_action_items_recommended_assignee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_action_items
    ADD CONSTRAINT fk_action_items_recommended_assignee FOREIGN KEY (recommended_assignee_id) REFERENCES public.users(id);


--
-- Name: activities fk_activities_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT fk_activities_actor FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: activities fk_activities_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT fk_activities_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: meeting_analysis fk_analysis_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_analysis
    ADD CONSTRAINT fk_analysis_meeting FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees fk_attendees_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT fk_attendees_meeting FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees fk_attendees_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_attendees
    ADD CONSTRAINT fk_attendees_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs fk_audit_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_checklists fk_checklists_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_checklists
    ADD CONSTRAINT fk_checklists_task FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: document_chunks fk_chunks_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT fk_chunks_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: comments fk_comments_author; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: comments fk_comments_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT fk_comments_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: comments fk_comments_target_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT fk_comments_target_user FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: contribution_reports fk_contribution_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribution_reports
    ADD CONSTRAINT fk_contribution_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: contribution_reports fk_contribution_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contribution_reports
    ADD CONSTRAINT fk_contribution_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: deliverables fk_deliverables_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT fk_deliverables_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: evaluation_settings fk_eval_settings_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_settings
    ADD CONSTRAINT fk_eval_settings_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: github_records fk_github_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_records
    ADD CONSTRAINT fk_github_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: github_records fk_github_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.github_records
    ADD CONSTRAINT fk_github_task FOREIGN KEY (linked_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: invitations fk_inv_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT fk_inv_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: meetings fk_meetings_edited_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT fk_meetings_edited_by FOREIGN KEY (edited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meetings fk_meetings_original; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT fk_meetings_original FOREIGN KEY (original_meeting_id) REFERENCES public.meetings(id) ON DELETE SET NULL;


--
-- Name: meetings fk_meetings_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT fk_meetings_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: meetings fk_meetings_uploaded_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT fk_meetings_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: milestones fk_milestones_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: notifications fk_notifications_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: project_members fk_pm_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members fk_pm_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ml_predictions fk_predictions_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_predictions
    ADD CONSTRAINT fk_predictions_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects fk_projects_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: evaluation_scores fk_scores_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT fk_scores_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: evaluation_scores fk_scores_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_scores
    ADD CONSTRAINT fk_scores_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_comments fk_task_comments_author; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT fk_task_comments_author FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_comments fk_task_comments_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT fk_task_comments_task FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_result_files fk_task_result_files_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_files
    ADD CONSTRAINT fk_task_result_files_task FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_result_files fk_task_result_files_uploader; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_files
    ADD CONSTRAINT fk_task_result_files_uploader FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks fk_tasks_assignee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks fk_tasks_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: tasks fk_tasks_milestone; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_milestone FOREIGN KEY (milestone_id) REFERENCES public.milestones(id) ON DELETE SET NULL;


--
-- Name: tasks fk_tasks_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_source_meeting; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_source_meeting FOREIGN KEY (source_meeting_id) REFERENCES public.meetings(id);


--
-- Name: workload_scores fk_workload_scores_project; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workload_scores
    ADD CONSTRAINT fk_workload_scores_project FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: workload_scores fk_workload_scores_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workload_scores
    ADD CONSTRAINT fk_workload_scores_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_result_links task_result_links_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_result_links
    ADD CONSTRAINT task_result_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_results task_results_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_results
    ADD CONSTRAINT task_results_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


