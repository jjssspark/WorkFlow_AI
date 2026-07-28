from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from typing import Any

import aiohttp
from redis.exceptions import ResponseError
from requests.exceptions import HTTPError as RequestsHTTPError

from core.cache import get_async_redis_queue_client
from core.db import get_pool
from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse
from llm_rag_assistant.app.services.chat_service import answer_question
from llm_rag_assistant.app.services.generation_service import RagConfigurationError

logger = logging.getLogger(__name__)

STREAM_KEY = "rag-jobs"
GROUP_NAME = "rag-workers"
PAYLOAD_FIELD = "payload"
MAX_OUTSTANDING_JOBS = 200
WAIT_TIMEOUT_SECONDS = 90.0
BLOCK_MS = 5000
_RESULT_CHANNEL_PREFIX = "rag-result:"

_ERROR_LLM_UNAVAILABLE = "llm_unavailable"
_ERROR_INTERNAL = "internal"


class RagQueueTimeoutError(RuntimeError):
    """워커가 제한 시간 안에 작업을 끝냈다는 신호를 보내지 않았을 때."""


class RagQueueFullError(RuntimeError):
    """대기 중인 작업이 너무 많아 더 받을 수 없을 때."""


async def enqueue_and_wait(
    project_id: int,
    question: str,
    user_id: int | None,
    history: list[dict] | None,
    timeout: float = WAIT_TIMEOUT_SECONDS,
) -> RagQueryResponse:
    """RAG 질의를 rag-jobs 스트림에 적재하고, RagQueueWorker가 처리를 끝낼 때까지 결과
    채널을 구독해 대기한 뒤 그대로 돌려준다. 호출부(chat_router)와 그 위의 Spring/프론트엔드
    계약은 바꾸지 않는다 - 요청 스레드가 처리 완료까지 붙잡혀 있다가 기존과 동일한
    RagQueryResponse를 반환하거나, 기존과 동일한 종류의 예외를 던진다.
    """
    job_id = uuid.uuid4().hex
    payload = json.dumps(
        {
            "job_id": job_id,
            "project_id": project_id,
            "question": question,
            "user_id": user_id,
            "history": history or [],
        },
        ensure_ascii=False,
    )

    client = get_async_redis_queue_client()
    channel = _result_channel(job_id)
    pubsub = client.pubsub()
    # 워커가 결과를 publish하기 전에 반드시 구독을 먼저 걸어야 한다 - 순서가 바뀌면
    # 워커가 이 요청보다 먼저 처리를 끝내는 경우 메시지를 영영 못 받는다.
    await pubsub.subscribe(channel)
    try:
        outstanding = await client.xlen(STREAM_KEY)
        if outstanding >= MAX_OUTSTANDING_JOBS:
            raise RagQueueFullError("대기 중인 RAG 질의가 너무 많습니다. 잠시 후 다시 시도해주세요.")
        await client.xadd(STREAM_KEY, {PAYLOAD_FIELD: payload}, maxlen=MAX_OUTSTANDING_JOBS, approximate=True)
        result = await _wait_for_result(pubsub, timeout)
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()

    if result["status"] == "error":
        message = result.get("message") or "RAG 응답 생성에 실패했습니다."
        if result.get("error") == _ERROR_LLM_UNAVAILABLE:
            raise RagConfigurationError(message)
        raise RuntimeError(message)
    return RagQueryResponse.model_validate(result["data"])


async def _wait_for_result(pubsub: Any, timeout: float) -> dict[str, Any]:
    async def _listen() -> dict[str, Any]:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            return json.loads(message["data"])
        raise RagQueueTimeoutError("RAG 큐 구독이 예기치 않게 종료되었습니다.")

    try:
        return await asyncio.wait_for(_listen(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise RagQueueTimeoutError("RAG 답변 생성이 시간 내에 끝나지 않았습니다.") from exc


def _result_channel(job_id: str) -> str:
    return f"{_RESULT_CHANNEL_PREFIX}{job_id}"


class RagQueueWorker:
    """rag-jobs 스트림을 컨슈머 그룹으로 소비해 answer_question()을 실행하고,
    결과를 rag-result:{job_id} 채널에 publish하는 인프로세스 백그라운드 워커.
    앱 lifespan에서 start()/stop()으로 기동·정지한다."""

    def __init__(self) -> None:
        self._consumer_name = f"rag-worker-{uuid.uuid4().hex}"
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        if self._running:
            return
        client = get_async_redis_queue_client()
        try:
            await client.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise
        self._running = True
        self._task = asyncio.create_task(self._run_loop(), name="rag-queue-worker")

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def _run_loop(self) -> None:
        client = get_async_redis_queue_client()
        while self._running:
            try:
                await self._poll_once(client)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("RAG 큐 폴링 실패, 잠시 후 재시도합니다.")
                await asyncio.sleep(1.0)

    async def _poll_once(self, client: Any) -> None:
        response = await client.xreadgroup(
            GROUP_NAME, self._consumer_name, {STREAM_KEY: ">"}, count=1, block=BLOCK_MS
        )
        if not response:
            return
        _, records = response[0]
        for record_id, fields in records:
            await self._process(client, record_id, fields)

    async def _process(self, client: Any, record_id: str, fields: dict[str, str]) -> None:
        try:
            job = json.loads(fields[PAYLOAD_FIELD])
            job_id = job["job_id"]
        except (KeyError, json.JSONDecodeError):
            logger.warning("잘못된 RAG 큐 레코드를 폐기합니다. recordId=%s", record_id)
            await self._ack(client, record_id)
            return

        pool = await anext(get_pool())
        try:
            response = await answer_question(
                pool, job["project_id"], job["question"], job.get("user_id"), history=job.get("history") or []
            )
            result: dict[str, Any] = {"status": "ok", "data": response.model_dump(mode="json")}
        except (aiohttp.ClientError, RequestsHTTPError, RagConfigurationError) as exc:
            logger.warning("RAG 큐 작업 처리 실패(LLM 응답 불가). jobId=%s, error=%s", job_id, exc)
            result = {"status": "error", "error": _ERROR_LLM_UNAVAILABLE, "message": str(exc)}
        except Exception as exc:
            logger.exception("RAG 큐 작업 처리 중 예기치 못한 오류. jobId=%s", job_id)
            result = {"status": "error", "error": _ERROR_INTERNAL, "message": str(exc)}

        try:
            await client.publish(_result_channel(job_id), json.dumps(result, ensure_ascii=False))
        except Exception:
            # 구독자(요청 스레드)가 이미 타임아웃으로 떠난 상태일 수 있다 - publish 실패로
            # 레코드를 계속 pending 상태로 남겨 재시도 루프에 태우지 않는다.
            logger.warning("RAG 큐 결과 publish 실패. jobId=%s", job_id)
        await self._ack(client, record_id)

    async def _ack(self, client: Any, record_id: str) -> None:
        await client.xack(STREAM_KEY, GROUP_NAME, record_id)
        await client.xdel(STREAM_KEY, record_id)
