"""
document_chunks 전체 임베딩을 최신 embed_text() 모델(BAAI/bge-m3)로 재계산해서 덮어쓴다.

임베딩 모델을 바꾸면 기존 벡터는 새 모델의 벡터 공간과 차원이 달라 호환되지 않는다.
이 스크립트를 실행하기 전에 반드시 V20260707_2__document_chunks_vector_1024.sql
(App/backend_spring/src/main/resources/db/migration)을 먼저 적용해서 컬럼 타입을 바꿔야
한다(이 스크립트는 스키마를 바꾸지 않는다).

실행:
    cd App/backend_fastapi
    python -m llm_rag_assistant.scripts.reembed_document_chunks
"""

from __future__ import annotations

import asyncio
import logging

import asyncpg

from core.db import create_pool
from llm_rag_assistant.app.services.embedding_service import embed_text
from llm_rag_assistant.app.services.vector_utils import to_vector_literal

logger = logging.getLogger(__name__)

_SELECT_ALL_SQL = "SELECT id, content FROM document_chunks ORDER BY id"
_UPDATE_EMBEDDING_SQL = "UPDATE document_chunks SET embedding = $1::vector WHERE id = $2"


async def reembed_all(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_SELECT_ALL_SQL)

    count = 0
    for row in rows:
        embedding = await embed_text(row["content"])
        async with pool.acquire() as conn:
            await conn.execute(_UPDATE_EMBEDDING_SQL, to_vector_literal(embedding), row["id"])
        count += 1
        logger.info("재임베딩 완료: id=%s (%d/%d)", row["id"], count, len(rows))
    return count


async def main() -> None:
    pool = await create_pool()
    try:
        count = await reembed_all(pool)
    finally:
        await pool.close()
    print(f"재임베딩 완료: {count}건")


if __name__ == "__main__":
    asyncio.run(main())
