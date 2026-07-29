from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse
from llm_rag_assistant.app.services.generation_service import RagConfigurationError
from llm_rag_assistant.app.services.rag_queue_service import (
    QUEUE_FULL_SENTINEL,
    RagQueueFullError,
    RagQueueTimeoutError,
    RagQueueWorker,
    STREAM_KEY,
    enqueue_and_wait,
)


class _FakePubSub:
    def __init__(self, client: "_FakeQueueRedis") -> None:
        self._client = client
        self._queue: asyncio.Queue = asyncio.Queue()
        self._channel: str | None = None

    async def subscribe(self, channel: str) -> None:
        self._channel = channel
        self._client.subscribers.setdefault(channel, []).append(self)
        await self._queue.put({"type": "subscribe", "channel": channel, "data": 1})

    async def unsubscribe(self, channel: str) -> None:
        subscribers = self._client.subscribers.get(channel, [])
        if self in subscribers:
            subscribers.remove(self)

    async def aclose(self) -> None:
        return None

    async def listen(self):
        while True:
            yield await self._queue.get()

    async def _deliver(self, channel: str, message: str) -> None:
        await self._queue.put({"type": "message", "channel": channel, "data": message})


class _FakeQueueRedis:
    """redis.asyncio 클라이언트의 Stream(XADD/XREADGROUP/XACK/XDEL)과 Pub/Sub을
    rag_queue_service가 실제로 쓰는 만큼만 흉내 낸 인메모리 페이크."""

    def __init__(self) -> None:
        self.stream: list[tuple[str, dict[str, str]]] = []
        self.subscribers: dict[str, list[_FakePubSub]] = {}
        self._next_id = 1
        self._delivered = 0  # xreadgroup(">")로 이미 배달한 개수 (단일 컨슈머 가정)

    async def xlen(self, key: str) -> int:
        return len(self.stream)

    async def xadd(self, key: str, fields: dict[str, str], maxlen=None, approximate=None) -> str:
        record_id = f"{self._next_id}-0"
        self._next_id += 1
        self.stream.append((record_id, fields))
        return record_id

    async def eval(self, script: str, numkeys: int, key: str, *args: str):
        """enqueue_and_wait가 쓰는 용량검사+XADD 원자 스크립트를 흉내 낸다.

        진짜 Lua 실행이 아니라 계약(상한 도달 시 QUEUE_FULL 반환, 아니면 적재 후 recordId 반환)만
        재현한다 - 스크립트 본문 자체는 실제 Redis로 따로 검증한다.
        """
        max_outstanding, payload, payload_field = int(args[0]), args[1], args[2]
        # 실제 Lua처럼 검사와 적재 사이에 await 지점을 두지 않는다 - 그래야 동시 요청이
        # 끼어들 수 없다는 원자성 계약이 더블에서도 성립한다.
        if len(self.stream) >= max_outstanding:
            return QUEUE_FULL_SENTINEL
        record_id = f"{self._next_id}-0"
        self._next_id += 1
        self.stream.append((record_id, {payload_field: payload}))
        return record_id

    async def xgroup_create(self, key: str, group: str, id: str = "0", mkstream: bool = True) -> None:
        return None

    async def xreadgroup(self, group: str, consumer: str, streams: dict[str, str], count: int = 1, block: int = 0):
        if self._delivered >= len(self.stream):
            # 실제 XREADGROUP은 BLOCK 동안 소켓에서 대기하며 이벤트 루프에 제어를 넘긴다.
            # 여기서 그냥 반환하면 await 지점이 없어 워커 루프가 다른 태스크를 굶기는
            # busy-loop이 된다(테스트 더블 한정 문제).
            await asyncio.sleep(0)
            return []
        record_id, fields = self.stream[self._delivered]
        self._delivered += 1
        return [(STREAM_KEY, [(record_id, fields)])]

    async def xack(self, key: str, group: str, record_id: str) -> None:
        return None

    async def xpending_range(self, key: str, group: str, min: str, max: str, count: int, idle: int | None = None):
        # 정체된 pending 메시지 회수 로직(claim_stale_pending)이 항상 먼저 호출되므로,
        # 이 테스트 더블에는 정체된 메시지가 없다는 뜻으로 빈 목록을 돌려준다.
        return []

    async def xclaim(self, key: str, group: str, consumer: str, min_idle_time: int, message_ids: list[str]):
        return []

    async def xdel(self, key: str, record_id: str) -> None:
        self.stream = [(rid, f) for rid, f in self.stream if rid != record_id]

    async def publish(self, channel: str, message: str) -> None:
        for subscriber in list(self.subscribers.get(channel, [])):
            await subscriber._deliver(channel, message)

    def pubsub(self) -> _FakePubSub:
        return _FakePubSub(self)


@pytest.fixture
def fake_client() -> _FakeQueueRedis:
    return _FakeQueueRedis()


@pytest.fixture(autouse=True)
def patch_redis_client(fake_client: _FakeQueueRedis):
    with patch(
        "llm_rag_assistant.app.services.rag_queue_service.get_async_redis_queue_client",
        return_value=fake_client,
    ):
        yield fake_client


@pytest.mark.asyncio
async def test_enqueue_and_wait_returns_worker_result(fake_client: _FakeQueueRedis) -> None:
    fake_result = RagQueryResponse(answer="답변", sources=[])
    with patch(
        "llm_rag_assistant.app.services.rag_queue_service.answer_question",
        new=AsyncMock(return_value=fake_result),
    ), patch(
        "llm_rag_assistant.app.services.rag_queue_service.get_pool_instance",
        new=AsyncMock(return_value=object()),
    ):
        worker = RagQueueWorker()
        wait_task = asyncio.create_task(
            enqueue_and_wait(project_id=1, question="질문", user_id=5, history=[], timeout=5)
        )
        # enqueue_and_wait가 XADD까지 마칠 시간을 준 뒤, 워커가 큐에서 그 레코드를 처리하게 한다.
        await asyncio.sleep(0.05)
        await worker._poll_once(fake_client)
        result = await wait_task

    assert result.answer == "답변"
    assert fake_client.stream == []  # 처리 후 XACK+XDEL로 정리됨


@pytest.mark.asyncio
async def test_enqueue_and_wait_raises_rag_configuration_error_on_llm_failure(fake_client: _FakeQueueRedis) -> None:
    with patch(
        "llm_rag_assistant.app.services.rag_queue_service.answer_question",
        new=AsyncMock(side_effect=RagConfigurationError("HF_TOKEN is not configured.")),
    ), patch(
        "llm_rag_assistant.app.services.rag_queue_service.get_pool_instance",
        new=AsyncMock(return_value=object()),
    ):
        worker = RagQueueWorker()
        wait_task = asyncio.create_task(
            enqueue_and_wait(project_id=1, question="질문", user_id=None, history=[], timeout=5)
        )
        await asyncio.sleep(0.05)
        await worker._poll_once(fake_client)
        with pytest.raises(RagConfigurationError):
            await wait_task


@pytest.mark.asyncio
async def test_enqueue_and_wait_times_out_when_worker_never_responds() -> None:
    with pytest.raises(RagQueueTimeoutError):
        await enqueue_and_wait(project_id=1, question="질문", user_id=None, history=[], timeout=0.05)


@pytest.mark.asyncio
async def test_enqueue_and_wait_raises_queue_full_without_adding(fake_client: _FakeQueueRedis) -> None:
    fake_client.stream = [(f"{i}-0", {"payload": "{}"}) for i in range(200)]
    with pytest.raises(RagQueueFullError):
        await enqueue_and_wait(project_id=1, question="질문", user_id=None, history=[], timeout=1)
    assert len(fake_client.stream) == 200  # 새 작업이 추가되지 않았어야 한다


@pytest.mark.asyncio
async def test_enqueue_never_reads_xlen_separately_from_the_add(fake_client: _FakeQueueRedis) -> None:
    """용량 검사(XLEN)와 적재(XADD)가 갈라져 있으면 그 사이에 들어온 동시 요청들이 전부
    같은 "여유 있음" 판정을 받아 상한을 넘겨 적재한다. 반드시 한 번의 원자적 실행이어야 한다."""

    async def _boom(*args, **kwargs):
        raise AssertionError("용량 검사와 적재는 원자 스크립트 한 번으로 처리해야 한다")

    fake_client.xlen = _boom
    fake_client.xadd = _boom

    # 워커가 없으므로 적재 후 타임아웃이 나는 게 정상 - 여기서 확인하려는 건 적재 경로다.
    with pytest.raises(RagQueueTimeoutError):
        await enqueue_and_wait(project_id=1, question="질문", user_id=None, history=[], timeout=0.05)
    assert len(fake_client.stream) == 1


@pytest.mark.asyncio
async def test_concurrent_enqueues_never_exceed_the_cap(fake_client: _FakeQueueRedis) -> None:
    """상한 직전에 동시에 몰려도 딱 남은 자리만큼만 적재되고 나머지는 큐 초과로 거절돼야 한다.

    예전처럼 XLEN을 먼저 읽고 XADD를 따로 보내면, 다섯 요청이 모두 199를 읽고 전부 적재해
    상한을 넘긴다. 넘긴 초과분은 MAXLEN 근사 트리밍에 잘려 아무 응답도 못 받은 채 사라진다.
    """
    fake_client.stream = [(f"{i}-0", {"payload": "{}"}) for i in range(199)]

    results = await asyncio.gather(
        *[
            enqueue_and_wait(project_id=1, question=f"질문{i}", user_id=None, history=[], timeout=0.05)
            for i in range(5)
        ],
        return_exceptions=True,
    )

    assert len(fake_client.stream) == 200  # 상한을 넘기지 않았다
    assert sum(isinstance(r, RagQueueFullError) for r in results) == 4
    # 자리를 차지한 한 건은 워커가 없어 타임아웃 - 조용히 사라지지 않고 원인이 드러난다.
    assert sum(isinstance(r, RagQueueTimeoutError) for r in results) == 1


@pytest.mark.asyncio
async def test_start_does_not_raise_when_redis_is_down(fake_client: _FakeQueueRedis) -> None:
    """기동 시점에 Redis가 죽어 있어도 start()가 예외를 던지면 안 된다.

    예전에는 start()가 xgroup_create를 직접 호출해, Redis가 내려가 있으면 main.py의
    lifespan이 예외를 로그만 남기고 넘어간 뒤 워커가 영영 뜨지 못했다 - 그 상태에서
    들어온 RAG 요청은 전부 WAIT_TIMEOUT_SECONDS까지 대기하다 503으로 떨어진다.
    """
    fake_client.xgroup_create = AsyncMock(side_effect=ConnectionError("redis down"))

    worker = RagQueueWorker()
    await worker.start()  # 예외가 나면 이 지점에서 실패한다
    try:
        await asyncio.sleep(0.05)
        assert worker.is_ready() is False  # 그룹을 못 만들었으니 아직 준비 안 됨
    finally:
        await worker.stop()


@pytest.mark.asyncio
async def test_worker_becomes_ready_once_redis_recovers(fake_client: _FakeQueueRedis) -> None:
    """Redis가 복구되면 프로세스 재시작 없이 워커가 스스로 컨슈머 그룹을 만들고 붙는다."""
    calls = {"count": 0}

    async def flaky_xgroup_create(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise ConnectionError("redis down")
        return None

    fake_client.xgroup_create = flaky_xgroup_create

    worker = RagQueueWorker()
    # 첫 회차 실패 후 백오프를 짧게 잡아 테스트가 오래 걸리지 않게 한다.
    with patch("llm_rag_assistant.app.services.rag_queue_service.INITIAL_BACKOFF_SECONDS", 0.01):
        await worker.start()
        try:
            for _ in range(100):
                if worker.is_ready():
                    break
                await asyncio.sleep(0.01)
            assert worker.is_ready() is True
            assert calls["count"] >= 2
        finally:
            await worker.stop()
