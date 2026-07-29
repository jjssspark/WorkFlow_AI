from __future__ import annotations

import json
from typing import AsyncIterator

import asyncpg

from core.config import get_settings

_pool: asyncpg.Pool | None = None


async def _register_jsonb_codec(conn: asyncpg.Connection) -> None:
    # asyncpg는 jsonb/json 컬럼을 기본적으로 원본 JSON 텍스트(str)로 반환한다.
    # 코덱을 등록하지 않으면 List[str] 컬럼(meeting_analysis.decisions 등)이
    # 문자열로 와서 ", ".join(...)이 문자 단위로 쪼개지는 버그가 생긴다.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text"
    )
    await conn.set_type_codec(
        "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text"
    )


async def create_pool() -> asyncpg.Pool:
    settings = get_settings()
    return await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=5,
        statement_cache_size=0,
        init=_register_jsonb_codec,
    )


async def get_pool_instance() -> asyncpg.Pool:
    """전역 커넥션 풀 싱글턴을 직접 반환한다. FastAPI 요청 핸들러 밖(백그라운드 워커 등)에서
    풀이 필요할 때는 이 함수를 쓴다 - get_pool()은 async generator라 anext()로만 소비하면
    generator가 닫히지 않은 채 남는다(FastAPI의 Depends()는 이 정리를 자동으로 해 주지만,
    수동 호출부에는 그 장치가 없다)."""
    global _pool
    if _pool is None:
        _pool = await create_pool()
    return _pool


async def get_pool() -> AsyncIterator[asyncpg.Pool]:
    """FastAPI Depends() 전용. 요청 핸들러 밖에서는 get_pool_instance()를 직접 쓸 것."""
    yield await get_pool_instance()
