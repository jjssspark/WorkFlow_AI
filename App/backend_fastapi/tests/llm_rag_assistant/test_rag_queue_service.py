from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from llm_rag_assistant.app.schema.chat_schema import RagQueryResponse
from llm_rag_assistant.app.services.generation_service import RagConfigurationError
from llm_rag_assistant.app.services.rag_queue_service import (
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

    async def xgroup_create(self, key: str, group: str, id: str = "0", mkstream: bool = True) -> None:
        return None

    async def xreadgroup(self, group: str, consumer: str, streams: dict[str, str], count: int = 1, block: int = 0):
        if self._delivered >= len(self.stream):
            return []
        record_id, fields = self.stream[self._delivered]
        self._delivered += 1
        return [(STREAM_KEY, [(record_id, fields)])]

    async def xack(self, key: str, group: str, record_id: str) -> None:
        return None

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
    ), patch("llm_rag_assistant.app.services.rag_queue_service.get_pool", return_value=_fake_pool_agen()):
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
    ), patch("llm_rag_assistant.app.services.rag_queue_service.get_pool", return_value=_fake_pool_agen()):
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


async def _fake_pool_agen():
    yield object()
