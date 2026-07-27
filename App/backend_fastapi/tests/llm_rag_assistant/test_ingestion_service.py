from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from llm_rag_assistant.app.services import ingestion_service
from llm_rag_assistant.app.services.chunking import chunk_text
from llm_rag_assistant.app.services.ingestion_service import ingest_content, sync_assignee


class _FakeConn:
    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.executed: list[tuple] = []
        self._next_id = 1
        self.transaction_entries = 0

    async def fetchrow(self, query: str, *args):
        self.calls.append((query, args))
        row = {"id": self._next_id}
        self._next_id += 1
        return row

    async def execute(self, query: str, *args):
        self.executed.append((query, args))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def transaction(self):
        connection = self

        class _Transaction:
            async def __aenter__(self):
                connection.transaction_entries += 1

            async def __aexit__(self, *exc):
                return False

        return _Transaction()


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.fixture(autouse=True)
def cache_epoch_advance():
    with patch("core.cache.advance_rag_project_epoch", new=AsyncMock()) as advance:
        yield advance


@pytest.mark.asyncio
async def test_ingest_content_chunks_embeds_and_inserts_each_chunk(cache_epoch_advance) -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    with patch(
        "llm_rag_assistant.app.services.ingestion_service.embed_text",
        new=AsyncMock(return_value=[0.1, 0.2]),
    ) as mock_embed:
        result = await ingest_content(
            pool, project_id=1, source_type="meeting", source_id=42, content="회의록 내용"
        )

    assert result.chunk_count == 1
    assert result.chunk_ids == [1]
    mock_embed.assert_awaited_once_with("회의록 내용")
    query, args = conn.calls[0]
    assert "INSERT INTO document_chunks" in query
    assert args[0] == 1  # project_id
    assert args[1] == "meeting"
    assert args[2] == 42
    assert args[3] == "회의록 내용"
    assert args[4] == "[0.10000000,0.20000000]"
    assert args[5] is None
    lock_query, lock_args = conn.executed[0]
    assert "pg_advisory_xact_lock" in lock_query
    assert lock_args == ("project:1",)
    delete_query, delete_args = conn.executed[1]
    assert "DELETE FROM document_chunks" in delete_query
    assert delete_args == (1, "meeting", 42)
    assert conn.transaction_entries == 1
    assert cache_epoch_advance.await_args_list == [
        ((1,), {}),
        ((1,), {}),
    ]


@pytest.mark.asyncio
async def test_ingest_content_stores_assignee_id_when_given() -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    with patch(
        "llm_rag_assistant.app.services.ingestion_service.embed_text",
        new=AsyncMock(return_value=[0.1]),
    ):
        await ingest_content(
            pool, project_id=1, source_type="task", source_id=7, content="업무 내용", assignee_id=42
        )

    _, args = conn.calls[0]
    assert args[5] == 42


@pytest.mark.asyncio
async def test_sync_assignee_updates_existing_chunks_without_reembedding() -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    await sync_assignee(pool, project_id=1, source_type="task", source_id=7, assignee_id=99)

    assert len(conn.executed) == 2
    assert "pg_advisory_xact_lock" in conn.executed[0][0]
    query, args = conn.executed[1]
    assert "UPDATE document_chunks" in query
    assert "SET assignee_id" in query
    assert args == (99, 1, "task", 7)


@pytest.mark.asyncio
async def test_sync_assignee_can_clear_assignee_to_none() -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    await sync_assignee(pool, project_id=1, source_type="task", source_id=7, assignee_id=None)

    _, args = conn.executed[1]
    assert args[0] is None


@pytest.mark.asyncio
async def test_ingest_content_blank_content_removes_existing_source(cache_epoch_advance) -> None:
    conn = _FakeConn()
    pool = _FakePool(conn)

    result = await ingest_content(pool, project_id=1, source_type="task", source_id=1, content="   ")

    assert result.chunk_ids == []
    assert result.chunk_count == 0
    assert conn.calls == []
    assert "DELETE FROM document_chunks" in conn.executed[1][0]
    assert conn.executed[1][1] == (1, "task", 1)
    assert cache_epoch_advance.await_count == 2


@pytest.mark.asyncio
async def test_delete_source_removes_only_matching_project_source(cache_epoch_advance) -> None:
    conn = _FakeConn()

    await ingestion_service.delete_source(
        _FakePool(conn),
        project_id=3,
        source_type="meeting",
        source_id=7,
    )

    assert "pg_advisory_xact_lock" in conn.executed[0][0]
    assert "DELETE FROM document_chunks" in conn.executed[1][0]
    assert conn.executed[1][1] == (3, "meeting", 7)
    assert cache_epoch_advance.await_count == 2


@pytest.mark.asyncio
async def test_delete_project_sources_removes_all_project_chunks(cache_epoch_advance) -> None:
    conn = _FakeConn()

    await ingestion_service.delete_project_sources(_FakePool(conn), project_id=3)

    assert "pg_advisory_xact_lock" in conn.executed[0][0]
    assert "DELETE FROM document_chunks" in conn.executed[1][0]
    assert conn.executed[1][1] == (3,)
    assert cache_epoch_advance.await_count == 2


# --- 임베딩 장애 시 인덱스 일관성 (UT-182) ---------------------------------
# ingest_content는 INSERT 전에 같은 source의 기존 청크를 통째로 지우고, 그 삭제와 삽입을
# 한 트랜잭션으로 묶는다. 아래 두 테스트가 지키는 불변식은 "실패가 아무 대가도 치르지
# 않는다"이다 - 락도, 커넥션도, 캐시 무효화도 남기지 않는다.

# chunk_size=500 / overlap=50 이므로 1000자는 3개 청크로 쪼개진다.
_THREE_CHUNK_CONTENT = "가" * 1000


class _CountingPool:
    def __init__(self, conn) -> None:
        self._conn = conn
        self.acquire_count = 0

    def acquire(self):
        self.acquire_count += 1
        return self._conn


class _RecordingTxConn:
    """트랜잭션 종료 시 전달된 예외 타입을 기록하는 fake conn.

    fake는 실제 롤백을 수행할 수 없다. 대신 asyncpg가 롤백을 실행하는 조건 - 예외가
    트랜잭션 컨텍스트의 __aexit__까지 전달되는 것 - 이 성립했는지를 기록으로 검증한다.
    """

    def __init__(self, fail_on_insert_call: int | None = None) -> None:
        self.calls: list[tuple] = []
        self.executed: list[tuple] = []
        self.transaction_exits: list[type[BaseException] | None] = []
        self._fail_on_insert_call = fail_on_insert_call
        self._next_id = 1

    async def execute(self, query: str, *args):
        self.executed.append((query, args))

    async def fetchrow(self, query: str, *args):
        self.calls.append((query, args))
        if self._fail_on_insert_call is not None and len(self.calls) == self._fail_on_insert_call:
            raise RuntimeError("INSERT 실패")
        row = {"id": self._next_id}
        self._next_id += 1
        return row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def transaction(self):
        connection = self

        class _Transaction:
            async def __aenter__(self):
                return None

            async def __aexit__(self, exc_type, exc, tb):
                connection.transaction_exits.append(exc_type)
                return False

        return _Transaction()


@pytest.mark.asyncio
async def test_ingest_content_does_not_touch_db_when_embedding_fails(cache_epoch_advance) -> None:
    """임베딩이 중간에 실패하면 DB 커넥션조차 잡지 않아야 한다.

    임베딩(로컬 CPU 추론, 1만자 문서 기준 수 초)을 트랜잭션 안으로 옮기면 삭제 자체는
    롤백으로 되돌아가지만 대가가 남는다: 트랜잭션 첫 줄의 pg_advisory_xact_lock을 계산
    내내 붙잡아 같은 프로젝트의 다른 인덱싱이 전부 대기하고, DB 커넥션도 그만큼 점유된다.
    무엇보다 캐시 무효화(advance_rag_project_epoch)가 트랜잭션 진입 전에 이미 나가 있어,
    인덱스는 한 글자도 안 바뀌었는데 그 프로젝트의 답변 캐시만 통째로 버려진다.
    """
    assert len(chunk_text(_THREE_CHUNK_CONTENT)) == 3
    conn = _RecordingTxConn()
    pool = _CountingPool(conn)
    # 임베딩은 로컬 SentenceTransformer 추론이다. 실패는 모델 로드 실패/OOM 형태로 온다.
    embed = AsyncMock(side_effect=[[0.1], RuntimeError("임베딩 모델 로드 실패")])

    with patch("llm_rag_assistant.app.services.ingestion_service.embed_text", new=embed):
        with pytest.raises(RuntimeError, match="임베딩 모델 로드 실패"):
            await ingest_content(
                pool, project_id=1, source_type="meeting", source_id=42, content=_THREE_CHUNK_CONTENT
            )

    assert pool.acquire_count == 0
    assert conn.executed == []
    assert conn.calls == []
    # 캐시 무효화도 일어나면 안 된다. 인덱스가 그대로인데 epoch만 올리면 멀쩡한 캐시를 버린다.
    assert cache_epoch_advance.await_count == 0


@pytest.mark.asyncio
async def test_ingest_content_propagates_insert_failure_out_of_transaction(cache_epoch_advance) -> None:
    """청크 일부만 INSERT된 뒤 실패하면 예외가 트랜잭션 밖으로 나가야 한다(=롤백).

    여기서 예외를 삼키고 성공 응답을 주면 선삭제만 반영된 반쪽 인덱스가 커밋된다.
    """
    conn = _RecordingTxConn(fail_on_insert_call=2)
    pool = _CountingPool(conn)

    with patch(
        "llm_rag_assistant.app.services.ingestion_service.embed_text",
        new=AsyncMock(return_value=[0.1]),
    ):
        with pytest.raises(RuntimeError, match="INSERT 실패"):
            await ingest_content(
                pool, project_id=1, source_type="meeting", source_id=42, content=_THREE_CHUNK_CONTENT
            )

    assert conn.transaction_exits == [RuntimeError]
    assert len(conn.calls) == 2  # 3청크 중 2번째에서 중단
    # 트랜잭션 진입 전 1회만 호출된다. 실패했으므로 완료 후 호출은 없다.
    assert cache_epoch_advance.await_count == 1
