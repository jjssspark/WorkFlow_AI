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
from core.db import get_pool_instance
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
# 워커가 이 메시지를 처리하던 중 죽으면(예외/프로세스 종료) XACK이 호출되지 않아 pending 상태로
# 영구히 남는다 - 아무도 재시도하지 않으면 그 요청은 영영 응답을 못 받는다(요청 스레드는 결국
# WAIT_TIMEOUT_SECONDS 뒤 타임아웃 에러만 받는다). Spring 쪽 DashboardAiQueueWorker의
# claimStalePending()과 동일한 목적으로, 이 시간 이상 idle 상태인 pending 메시지를 회수한다.
STALE_PENDING_IDLE_MS = 10 * 60 * 1000
PENDING_SCAN_COUNT = 100
# Redis가 내려가 있는 동안 폴링 실패가 초당 수십 회씩 로그를 채우지 않도록 지수 백오프를 건다.
INITIAL_BACKOFF_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 30.0

_ERROR_LLM_UNAVAILABLE = "llm_unavailable"
_ERROR_INTERNAL = "internal"


class RagQueueTimeoutError(RuntimeError):
    """워커가 제한 시간 안에 작업을 끝냈다는 신호를 보내지 않았을 때."""


class RagQueueFullError(RuntimeError):
    """대기 중인 작업이 너무 많아 더 받을 수 없을 때."""


QUEUE_FULL_SENTINEL = "QUEUE_FULL"
# 용량 검사와 적재를 한 번의 원자적 실행으로 묶는다. XLEN을 읽고 XADD를 따로 보내면 그 사이에
# 들어온 다른 요청들이 전부 같은 "여유 있음" 판정을 받아 상한을 넘겨 적재한다.
# XADD에 MAXLEN을 걸지 않는 것도 중요하다 - 근사 트리밍은 아직 처리되지 않은 작업을 조용히
# 잘라내고, 그 요청은 아무 응답도 못 받은 채 WAIT_TIMEOUT_SECONDS까지 기다리게 된다.
# 여기서 상한을 원자적으로 지키므로 트리밍 없이도 스트림 길이가 상한을 넘지 않는다
# (처리 끝난 레코드는 워커가 XACK 직후 XDEL로 지운다).
# Spring 쪽 dashboard-ai-enqueue.lua와 같은 구조다.
_ENQUEUE_IF_CAPACITY_SCRIPT = """
if not redis.acl_check_cmd('XLEN', KEYS[1]) then
    return redis.error_reply('XLEN permission denied')
end
if not redis.acl_check_cmd('XADD', KEYS[1], '*', ARGV[3], ARGV[2]) then
    return redis.error_reply('XADD permission denied')
end
local outstanding = redis.call('XLEN', KEYS[1])
if outstanding >= tonumber(ARGV[1]) then
    return 'QUEUE_FULL'
end
return redis.call('XADD', KEYS[1], '*', ARGV[3], ARGV[2])
"""


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
        record_id = await client.eval(
            _ENQUEUE_IF_CAPACITY_SCRIPT, 1, STREAM_KEY, str(MAX_OUTSTANDING_JOBS), payload, PAYLOAD_FIELD
        )
        if record_id is None or record_id == QUEUE_FULL_SENTINEL:
            raise RagQueueFullError("대기 중인 RAG 질의가 너무 많습니다. 잠시 후 다시 시도해주세요.")
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
        self._group_ready = False

    async def start(self) -> None:
        """루프만 띄우고 Redis는 건드리지 않는다. 기동 시점에 Redis가 죽어 있으면 예외가 나는데,
        여기서 컨슈머 그룹을 만들다 실패하면 워커가 영영 뜨지 못한 채(main.py는 로그만 남기고
        진행) RAG 요청이 전부 WAIT_TIMEOUT_SECONDS까지 대기하다 503으로 떨어진다.
        그룹 생성은 루프 안에서 재시도한다(Spring DashboardAiQueueWorker와 같은 방식)."""
        if self._running:
            return
        self._running = True
        self._group_ready = False
        self._task = asyncio.create_task(self._run_loop(), name="rag-queue-worker")

    async def stop(self) -> None:
        self._running = False
        task, self._task = self._task, None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    def is_ready(self) -> bool:
        """컨슈머 그룹까지 준비돼 실제로 작업을 꺼낼 수 있는 상태인지."""
        return self._running and self._group_ready and self._task is not None and not self._task.done()

    async def _ensure_group(self, client: Any) -> None:
        try:
            await client.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise
        self._group_ready = True

    async def _run_loop(self) -> None:
        client = get_async_redis_queue_client()
        backoff = INITIAL_BACKOFF_SECONDS
        while self._running:
            try:
                if not self._group_ready:
                    await self._ensure_group(client)
                await self._poll_once(client)
            except asyncio.CancelledError:
                raise
            except Exception:
                # Redis가 끊긴 동안 그룹이 사라졌을 수도 있으므로 다음 회차에 다시 만든다.
                self._group_ready = False
                logger.exception("RAG 큐 폴링 실패, %.1f초 후 재시도합니다.", backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            else:
                backoff = INITIAL_BACKOFF_SECONDS

    async def _poll_once(self, client: Any) -> None:
        records = await self._claim_stale_pending(client)
        if not records:
            response = await client.xreadgroup(
                GROUP_NAME, self._consumer_name, {STREAM_KEY: ">"}, count=1, block=BLOCK_MS
            )
            if response:
                _, records = response[0]
        if not records:
            return
        for record_id, fields in records:
            await self._process(client, record_id, fields)

    async def _claim_stale_pending(self, client: Any) -> list[tuple[str, dict[str, str]]]:
        try:
            pending = await client.xpending_range(
                STREAM_KEY, GROUP_NAME, min="-", max="+", count=PENDING_SCAN_COUNT, idle=STALE_PENDING_IDLE_MS
            )
        except ResponseError:
            return []
        if not pending:
            return []
        message_ids = [entry["message_id"] for entry in pending]
        claimed = await client.xclaim(
            STREAM_KEY, GROUP_NAME, self._consumer_name, min_idle_time=STALE_PENDING_IDLE_MS, message_ids=message_ids
        )
        return claimed or []

    async def _process(self, client: Any, record_id: str, fields: dict[str, str]) -> None:
        try:
            job = json.loads(fields[PAYLOAD_FIELD])
            job_id = job["job_id"]
        except (KeyError, json.JSONDecodeError):
            logger.warning("잘못된 RAG 큐 레코드를 폐기합니다. recordId=%s", record_id)
            await self._ack(client, record_id)
            return

        pool = await get_pool_instance()
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
