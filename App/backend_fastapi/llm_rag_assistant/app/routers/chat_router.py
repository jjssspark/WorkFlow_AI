from __future__ import annotations

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from requests.exceptions import HTTPError as RequestsHTTPError
from typing import Literal

from core.db import get_pool
from llm_rag_assistant.app.schema.chat_schema import (
    RagAssigneeSyncRequest,
    RagIngestRequest,
    RagIngestResponse,
    RagQueryRequest,
    RagQueryResponse,
)
from llm_rag_assistant.app.security import verify_internal_api_key
from llm_rag_assistant.app.services.generation_service import RagConfigurationError
from llm_rag_assistant.app.services.ingestion_service import (
    delete_project_sources,
    delete_source,
    ingest_content,
    sync_assignee,
)
from llm_rag_assistant.app.services.rag_queue_service import (
    RagQueueFullError,
    RagQueueTimeoutError,
    enqueue_and_wait,
)

router = APIRouter(prefix="/ai/rag", tags=["rag"], dependencies=[Depends(verify_internal_api_key)])


@router.post("/ingest", response_model=RagIngestResponse)
async def ingest(request: RagIngestRequest, pool=Depends(get_pool)) -> RagIngestResponse:
    return await ingest_content(
        pool, request.project_id, request.source_type, request.source_id, request.content, request.assignee_id
    )


@router.post("/assignee-sync", status_code=204)
async def assignee_sync(request: RagAssigneeSyncRequest, pool=Depends(get_pool)) -> None:
    # 담당자가 재배정된 뒤 기존 청크의 assignee_id가 낡은 채로 남아 개인화 검색이
    # 옛 담당자에게 계속 걸리지 않도록, 콘텐츠/임베딩 재계산 없이 메타데이터만 갱신한다.
    await sync_assignee(pool, request.project_id, request.source_type, request.source_id, request.assignee_id)


@router.delete("/projects/{project_id}/sources/{source_type}/{source_id}", status_code=204)
async def remove_source(
    project_id: int,
    source_type: Literal["meeting", "task", "action_item"],
    source_id: int,
    pool=Depends(get_pool),
) -> None:
    await delete_source(pool, project_id, source_type, source_id)


@router.delete("/projects/{project_id}/sources", status_code=204)
async def remove_project_sources(project_id: int, pool=Depends(get_pool)) -> None:
    await delete_project_sources(pool, project_id)


@router.post("/query", response_model=RagQueryResponse)
async def query(request: RagQueryRequest) -> RagQueryResponse:
    # 라우터 레벨의 verify_internal_api_key 의존성이 Spring(RagController) 외의 직접 호출을
    # 차단하므로, 이 경로에 도달하는 project_id/user_id는 Spring이 검증/주입한 값이다:
    #   - project_id: RagController.query()의 @PreAuthorize("@projectAccess.isMember(#request.project_id())")가
    #     요청자가 해당 프로젝트 멤버가 아니면 컨트롤러 진입 전에 403으로 차단한다.
    #   - user_id: RagController.query()가 요청 바디 값을 무시하고 CurrentUser.id()(인증 세션)로 덮어써서 보낸다.
    # 실제 임베딩/검색/LLM 호출은 Redis Queue(rag-jobs)에 적재되어 RagQueueWorker가 처리한다.
    # 이 요청은 워커가 결과를 publish할 때까지 대기했다가 그대로 반환하므로, Spring/프론트엔드
    # 입장에서는 지금까지와 동일한 단일 요청-응답으로 보인다 - 다만 내부적으로는 워커 분리·
    # 재시도·중복 요청 병합의 여지가 생긴다.
    try:
        history = [{"role": m.role, "content": m.content} for m in request.history]
        return await enqueue_and_wait(
            request.project_id, request.question, request.user_id, history=history
        )
    except (aiohttp.ClientError, RequestsHTTPError) as exc:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable"}) from exc
    except RagConfigurationError as exc:
        # HF_TOKEN 미설정 등 generate_answer의 설정 오류는 LLM 연결 실패와 마찬가지로
        # 클라이언트 입장에선 "지금은 답변 불가"이므로 503으로 응답한다. 그 외 RuntimeError는
        # 실제 코드 결함일 수 있으므로 여기서 잡지 않고 500으로 그대로 드러낸다.
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable"}) from exc
    except (RagQueueTimeoutError, RagQueueFullError) as exc:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable"}) from exc
