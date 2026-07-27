from __future__ import annotations

from core import cache
from llm_rag_assistant.app.schema.chat_schema import RagIngestResponse
from llm_rag_assistant.app.services.chunking import chunk_text
from llm_rag_assistant.app.services.embedding_service import embed_text
from llm_rag_assistant.app.services.vector_utils import to_vector_literal

_INSERT_CHUNK_SQL = """
INSERT INTO document_chunks (project_id, source_type, source_id, content, embedding, assignee_id)
VALUES ($1, $2, $3, $4, $5::vector, $6)
RETURNING id
"""

_UPDATE_ASSIGNEE_SQL = """
UPDATE document_chunks
SET assignee_id = $1
WHERE project_id = $2 AND source_type = $3 AND source_id = $4
"""

_DELETE_SOURCE_SQL = """
DELETE FROM document_chunks
WHERE project_id = $1 AND source_type = $2 AND source_id = $3
"""

_DELETE_PROJECT_SOURCES_SQL = """
DELETE FROM document_chunks
WHERE project_id = $1
"""

_LOCK_PROJECT_SQL = """
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
"""


async def _lock_project(conn, project_id: int) -> None:
    await conn.execute(_LOCK_PROJECT_SQL, f"project:{project_id}")


async def ingest_content(
    pool, project_id: int, source_type: str, source_id: int, content: str, assignee_id: int | None = None
) -> RagIngestResponse:
    chunks = chunk_text(content)
    if not chunks:
        # 아래 트랜잭션은 INSERT 전에 같은 source의 기존 청크를 통째로 지운다. 청크가 없는데
        # 계속 진행하면 삭제만 반영돼 멀쩡한 인덱스가 사라진다. 삭제는 delete_source로만 한다.
        # HTTP 경로는 스키마(RagIngestRequest)에서 이미 422로 막히므로, 여기 도달하는 건
        # 서비스를 직접 부르는 백필 스크립트뿐이다 - 중단시키지 않고 조용히 건너뛴다.
        return RagIngestResponse(chunk_ids=[], chunk_count=0)

    embeddings = [await embed_text(chunk) for chunk in chunks]

    await cache.advance_rag_project_epoch(project_id)
    chunk_ids: list[int] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_project(conn, project_id)
            await conn.execute(_DELETE_SOURCE_SQL, project_id, source_type, source_id)
            for chunk, embedding in zip(chunks, embeddings, strict=True):
                row = await conn.fetchrow(
                    _INSERT_CHUNK_SQL,
                    project_id,
                    source_type,
                    source_id,
                    chunk,
                    to_vector_literal(embedding),
                    assignee_id,
                )
                chunk_ids.append(row["id"])
    await cache.advance_rag_project_epoch(project_id)

    return RagIngestResponse(chunk_ids=chunk_ids, chunk_count=len(chunk_ids))


async def sync_assignee(pool, project_id: int, source_type: str, source_id: int, assignee_id: int | None) -> None:
    """담당자가 바뀐 뒤에도 document_chunks.assignee_id가 낡은 채로 남아있지 않도록,
    기존 청크(내용/임베딩은 그대로) 메타데이터만 갱신한다. 재임베딩이 필요 없어 저렴하다."""
    await cache.advance_rag_project_epoch(project_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_project(conn, project_id)
            await conn.execute(_UPDATE_ASSIGNEE_SQL, assignee_id, project_id, source_type, source_id)
    await cache.advance_rag_project_epoch(project_id)


async def delete_source(pool, project_id: int, source_type: str, source_id: int) -> None:
    await cache.advance_rag_project_epoch(project_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_project(conn, project_id)
            await conn.execute(_DELETE_SOURCE_SQL, project_id, source_type, source_id)
    await cache.advance_rag_project_epoch(project_id)


async def delete_project_sources(pool, project_id: int) -> None:
    await cache.advance_rag_project_epoch(project_id)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_project(conn, project_id)
            await conn.execute(_DELETE_PROJECT_SOURCES_SQL, project_id)
    await cache.advance_rag_project_epoch(project_id)
