from __future__ import annotations

import logging

import httpx
import ollama
from fastapi import APIRouter, Depends, HTTPException

from ai_contribution_report.app.schema.contribution_schema import (
    ContributionReportRequest,
    MemberContribution,
)
from ai_contribution_report.app.services.contribution_service import generate_contribution_reports
from core.security import verify_internal_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/report", tags=["contribution"], dependencies=[Depends(verify_internal_api_key)])


@router.post("/contribution", response_model=list[MemberContribution])
async def generate_report(request: ContributionReportRequest):
    """
    심사자 전용 기여도 리포트 생성.
    Spring Boot가 내부 호출하는 AI 백엔드 엔드포인트.
    """
    try:
        return await generate_contribution_reports(request.project_id)
    except (httpx.ConnectError, httpx.TimeoutException, ollama.ResponseError) as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "success": False,
                "error": {
                    "code": "CONTRIBUTION_LLM_UNAVAILABLE",
                    "message": "AI 요약 서비스에 연결할 수 없습니다.",
                    "details": {},
                },
            },
        ) from exc
    except Exception as exc:
        logger.exception("기여도 리포트 생성 실패 (project_id=%s)", request.project_id)
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": {
                    "code": "CONTRIBUTION_REPORT_FAILED",
                    "message": "기여도 리포트를 생성하지 못했습니다.",
                    "details": {},
                },
            },
        ) from exc
