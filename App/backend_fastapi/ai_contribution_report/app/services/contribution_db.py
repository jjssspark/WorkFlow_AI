from __future__ import annotations

import json
import logging

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from ml_workload_score.app.services.workload_db import get_engine

logger = logging.getLogger(__name__)

_TASK_QUERY = text("""
    SELECT
        pm.user_id AS user_id,
        u.name AS name,
        COUNT(t.id) AS todo_total,
        -- tasks.status는 한글이 아니라 프론트(task.ts의 TaskStatus)가 정의한 영문 슬러그로
        -- 저장된다("todo"|"inprogress"|"blocked"|"done"). 과거 '완료'(한글) 비교로 인해
        -- 완료 업무가 있어도 todo_done이 항상 0으로 집계되던 버그를 수정
        -- (ml_workload_score/app/services/workload_model.py의 normalize_status와 동일한 문제).
        COUNT(t.id) FILTER (WHERE t.status = 'done') AS todo_done
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN tasks t ON t.project_id = pm.project_id AND t.assignee_id = pm.user_id
    WHERE pm.project_id = :project_id AND pm.role != 'REVIEWER'
    GROUP BY pm.user_id, u.name
    ORDER BY pm.user_id
""")

_MEETING_QUERY = text("""
    SELECT
        pm.user_id AS user_id,
        COUNT(DISTINCT m.id) AS meetings_total,
        COUNT(DISTINCT ma.meeting_id) AS meetings_attended
    FROM project_members pm
    LEFT JOIN meetings m ON m.project_id = pm.project_id
    LEFT JOIN meeting_attendees ma ON ma.meeting_id = m.id AND ma.user_id = pm.user_id
    WHERE pm.project_id = :project_id AND pm.role != 'REVIEWER'
    GROUP BY pm.user_id
""")

_INSERT_QUERY = text("""
    INSERT INTO contribution_reports (project_id, user_id, summary, evidence)
    VALUES (:project_id, :user_id, :summary, CAST(:evidence AS JSONB))
""")

_WORKLOAD_QUERY = text("""
    SELECT DISTINCT ON (user_id) user_id, overload_score, anomaly_type
    FROM workload_scores
    WHERE project_id = :project_id
    ORDER BY user_id, computed_at DESC
""")


def merge_contribution_rows(task_rows: list[dict], meeting_rows: list[dict]) -> list[dict]:
    """업무 집계와 회의 집계를 user_id 기준으로 합친다. 회의 기록이 없는 유저는 0으로 채운다."""
    meeting_by_user = {row["user_id"]: row for row in meeting_rows}
    merged = []
    for row in task_rows:
        meeting_row = meeting_by_user.get(row["user_id"], {})
        merged.append({
            "user_id": row["user_id"],
            "name": row["name"],
            "todo_done": int(row["todo_done"]),
            "todo_total": int(row["todo_total"]),
            "meetings_attended": int(meeting_row.get("meetings_attended", 0)),
            "meetings_total": int(meeting_row.get("meetings_total", 0)),
        })
    return merged


def load_contribution_inputs(project_id: int) -> list[dict]:
    """project_id의 팀원별 업무 완료율 + 회의 참석률을 tasks/meetings 테이블에서 직접 조회한다."""
    engine = get_engine()
    try:
        with engine.connect() as conn:
            task_rows = [dict(row) for row in conn.execute(_TASK_QUERY, {"project_id": project_id}).mappings()]
            meeting_rows = [dict(row) for row in conn.execute(_MEETING_QUERY, {"project_id": project_id}).mappings()]
    finally:
        engine.dispose()
    return merge_contribution_rows(task_rows, meeting_rows)


def save_contribution_reports(project_id: int, reports: list[dict]) -> None:
    """생성된 리포트를 contribution_reports에 이력으로 INSERT한다 (기존 row를 덮어쓰지 않음)."""
    if not reports:
        return
    engine = get_engine()
    try:
        with engine.begin() as conn:
            for report in reports:
                conn.execute(_INSERT_QUERY, {
                    "project_id": project_id,
                    "user_id": report["user_id"],
                    "summary": report["summary"],
                    "evidence": json.dumps(report["evidence"], ensure_ascii=False),
                })
    finally:
        engine.dispose()


def load_workload_scores(project_id: int) -> dict[int, dict]:
    """유저별 가장 최근 워크로드 스코어를 조회한다. 아직 계산되지 않은 유저는 결과에 없다."""
    engine = get_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(_WORKLOAD_QUERY, {"project_id": project_id}).mappings()
            return {
                row["user_id"]: {"overload_score": float(row["overload_score"]), "anomaly_type": row["anomaly_type"]}
                for row in rows
            }
    except ProgrammingError:
        logger.info("workload_scores 조회를 건너뜀 (project_id=%s)", project_id)
        return {}
    finally:
        engine.dispose()
