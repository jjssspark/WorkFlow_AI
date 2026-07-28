from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from contribution_score.app.schema.contribution_schema import (
    ContributionScoreData,
    ContributionScoreResponse,
)
from contribution_score.app.services.contribution_db import load_meeting_attendance
from contribution_score.app.services.contribution_service import compute_contribution_scores
from core.security import verify_internal_api_key
from ml_workload_score.app.services.workload_service import get_workload_score

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/score", tags=["contribution"], dependencies=[Depends(verify_internal_api_key)])


@router.post("/contribution", response_model=ContributionScoreResponse)
async def score_contribution(project_id: int):
    """
    FS-09 기여도 점수 (workload/task/meeting 3피처 가중 평균).
    Spring Boot가 내부 호출하는 AI 백엔드 엔드포인트.
    """
    try:
        workload_data = await get_workload_score(project_id)

        if not workload_data.members:
            data = ContributionScoreData(
                project_id=project_id,
                members=[],
                note="배정된 업무가 없어 기여도 점수를 계산할 수 없습니다.",
            )
            return {"success": True, "data": data}

        attendance, total_meetings = load_meeting_attendance(project_id)
        members = compute_contribution_scores(workload_data.members, attendance, total_meetings)
        data = ContributionScoreData(
            project_id=project_id,
            members=members,
            team_mean_completion=workload_data.team_mean_completion,
        )
        return {"success": True, "data": data}
    except Exception:
        logger.exception("기여도 점수 계산 실패 (project_id=%s)", project_id)
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": {
                    "code": "CONTRIBUTION_SCORE_FAILED",
                    "message": "기여도 점수를 계산하지 못했습니다.",
                    "details": {},
                },
            },
        )
