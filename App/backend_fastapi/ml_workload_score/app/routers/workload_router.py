from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from core.security import verify_internal_api_key
from ml_workload_score.app.schema.workload_schema import WorkloadScoreResponse
from ml_workload_score.app.services.tracing import setup_langsmith
from ml_workload_score.app.services.workload_service import get_workload_score

logger = logging.getLogger(__name__)

setup_langsmith()

router = APIRouter(prefix="/ai/score", tags=["workload"], dependencies=[Depends(verify_internal_api_key)])


@router.post("/workload", response_model=WorkloadScoreResponse)
async def score_workload(project_id: int, use_synthetic_fallback: bool = False):
    """
    FS-5 업무 편중 점수 (팀원별 과부하/저활동 탐지).
    Spring Boot가 내부 호출하는 AI 백엔드 엔드포인트.
    """
    try:
        data = await get_workload_score(project_id, use_synthetic_fallback=use_synthetic_fallback)
        return {"success": True, "data": data}
    except Exception:
        logger.exception("workload score 계산 실패 (project_id=%s)", project_id)
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": {
                    "code": "WORKLOAD_SCORE_FAILED",
                    "message": "업무 편중 점수를 계산하지 못했습니다.",
                    "details": {},
                },
            },
        )
