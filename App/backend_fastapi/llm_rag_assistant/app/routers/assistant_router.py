from __future__ import annotations

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from requests.exceptions import HTTPError as RequestsHTTPError

from core.db import get_pool
from llm_rag_assistant.app.graph.assistant_graph import resume_command, start_command
from llm_rag_assistant.app.schema.assistant_schema import (
    ActionCard,
    AssistantCommandRequest,
    AssistantResponse,
    AssistantResumeRequest,
)
from core.security import verify_internal_api_key
from llm_rag_assistant.app.services.chat_service import answer_question
from llm_rag_assistant.app.services.command_classifier import is_command_candidate
from llm_rag_assistant.app.services.generation_service import RagConfigurationError

router = APIRouter(prefix="/ai/assistant", tags=["assistant"], dependencies=[Depends(verify_internal_api_key)])


def _to_response(outcome) -> AssistantResponse:
    card = ActionCard(**outcome.card.model_dump()) if outcome.card else None
    return AssistantResponse(
        type=outcome.type, message=outcome.message, thread_id=outcome.thread_id, card=card
    )


@router.post("/command", response_model=AssistantResponse)
async def command(request: AssistantCommandRequest, pool=Depends(get_pool)) -> AssistantResponse:
    # project_id/user_id/user_role은 Spring AssistantController가 인증 세션 값으로 덮어써서 보낸다.
    # 대화 기록(history)에서는 어떤 권한값도 유도하지 않는다.
    history = [{"role": m.role, "content": m.content} for m in request.history]

    # 명령으로 판정되면 그래프로 라우팅한다. 계획 노드가 실제 명령이 아니라고 보면(오탐)
    # 빈 계획 → 되묻기 메시지로 안전하게 빠진다.
    if is_command_candidate(request.question):
        outcome = await start_command(
            pool,
            {
                "question": request.question,
                "history": history,
                "project_id": request.project_id,
                "user_id": request.user_id,
                "user_role": request.user_role,
            },
        )
        return _to_response(outcome)

    # 질문 경로: 기존 RAG 파이프라인을 그대로 탄다.
    try:
        result = await answer_question(
            pool, request.project_id, request.question, request.user_id, history=history
        )
    except (aiohttp.ClientError, RequestsHTTPError) as exc:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable"}) from exc
    except RagConfigurationError as exc:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable"}) from exc
    return AssistantResponse(type="answer", message=result.answer, sources=result.sources)


@router.post("/resume", response_model=AssistantResponse)
async def resume(request: AssistantResumeRequest) -> AssistantResponse:
    # thread 소유권은 Spring AssistantController가 검사한다(여기까지 오면 검증된 요청이다).
    outcome = await resume_command(
        request.thread_id,
        {"step_id": request.step_id, "ok": request.ok, "error": request.error},
    )
    return _to_response(outcome)
