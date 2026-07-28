from __future__ import annotations

import logging
from functools import lru_cache

from redis import Redis
from redis.asyncio import Redis as AsyncRedis

from core.config import get_settings

logger = logging.getLogger(__name__)

REDIS_SOCKET_TIMEOUT_SECONDS = 2.0
# RAG 큐(rag_queue_service)의 XREADGROUP BLOCK, pubsub listen()처럼 짧게는 수 초, 길게는
# 응답 생성이 끝날 때까지 소켓을 열어둔 채 기다리는 연산 전용 클라이언트. 위 2초 타임아웃을
# 그대로 쓰면 LLM 응답을 기다리는 도중 소켓이 끊겨 버린다.
QUEUE_SOCKET_TIMEOUT_SECONDS = None


@lru_cache
def get_redis_client() -> Redis:
    settings = get_settings()
    return Redis.from_url(
        settings.redis_url,
        username=settings.redis_username,
        password=settings.redis_password,
        decode_responses=True,
        socket_connect_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        retry_on_timeout=False,
    )


@lru_cache
def get_async_redis_client() -> AsyncRedis:
    settings = get_settings()
    return AsyncRedis.from_url(
        settings.redis_url,
        username=settings.redis_username,
        password=settings.redis_password,
        decode_responses=True,
        socket_connect_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        retry_on_timeout=False,
    )


@lru_cache
def get_async_redis_queue_client() -> AsyncRedis:
    """Redis Stream/Pub-Sub의 블로킹 대기 연산 전용 클라이언트. 캐시 읽기/쓰기용
    get_async_redis_client()와 커넥션을 분리해, 큐 대기가 길어져도 캐시 경로의 짧은
    타임아웃 설정에 영향을 주지 않는다."""
    settings = get_settings()
    return AsyncRedis.from_url(
        settings.redis_url,
        username=settings.redis_username,
        password=settings.redis_password,
        decode_responses=True,
        socket_connect_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
        socket_timeout=QUEUE_SOCKET_TIMEOUT_SECONDS,
        retry_on_timeout=False,
    )


async def advance_rag_project_epoch(project_id: int) -> None:
    """RAG 답변 캐시의 프로젝트 epoch를 올려 기존 캐시를 무효화한다.

    캐시는 DB 원본의 파생물이므로 무효화 실패가 원본 변경 API를 실패시켜서는 안 된다.
    특히 DB 커밋 뒤 호출에서 예외를 전파하면 "DB에는 반영됐는데 호출자에겐 실패"인
    부분 성공이 되어, 재시도 시 같은 내용이 중복 적재된다. 읽기 경로(chat_service)도
    동일하게 캐시 예외를 삼키고 진행하므로 정책을 맞춘다.

    무효화에 실패하면 낡은 답변이 캐시 TTL(30분) 동안 남을 수 있다.
    """
    try:
        await get_async_redis_client().incr(f"rag_epoch:{project_id}")
    except Exception:
        logger.warning("RAG 답변 캐시 무효화 실패, 낡은 답변이 TTL 동안 남을 수 있습니다. project_id=%s", project_id)
