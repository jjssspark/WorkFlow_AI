"""IT-040 업무 재색인 반영 / IT-041 담당자 변경 동기화 / IT-043 프로젝트 삭제 인덱스 정리.

test_rag_indexing_integration.py가 "넣은 것이 나오는가"를 봤다면, 여기서는 "지우고 바꾸는
것이 실제로 지워지고 바뀌는가"를 본다. 세 케이스 모두 색인을 **변경**한 뒤 질의 결과가
따라 바뀌는지를 확인한다.

이 구간이 지금까지 실행된 적이 없는 이유: 기존 test_ingestion_service.py는 _FakePool을 쓴다.
가짜 커넥션의 execute()는 SQL 문자열과 인자를 리스트에 기록만 하고 아무것도 지우지 않는다.
그래서 아래 세 문장은 작성된 이후 한 번도 DB에서 돌지 않았다.

    _DELETE_SOURCE_SQL          - ingest_content가 재색인 전에 기존 청크를 비우는 문장
    _UPDATE_ASSIGNEE_SQL        - sync_assignee가 담당자 메타데이터만 갱신하는 문장
    _DELETE_PROJECT_SOURCES_SQL - delete_project_sources가 프로젝트 벡터를 정리하는 문장

임베딩 대역과 결정론적 축 벡터의 근거는 test_rag_indexing_integration.py 상단 주석과 같다.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from core.db import get_pool
from core.security import verify_internal_api_key
from llm_rag_assistant.app.routers import chat_router
from llm_rag_assistant.app.services import chat_service, ingestion_service

_EMBEDDING_DIMENSIONS = 1024
_KEYWORD_AXES = ("결제", "디자인", "배포")
_FALLBACK_AXIS = len(_KEYWORD_AXES)

_ANSWER_STUB = "테스트용 고정 답변"

# 토큰 "내가"가 chat_service._PERSONAL_INTENT_TOKENS에 있어 개인화 의도로 분류되고,
# 검색이 _SEARCH_BY_ASSIGNEE_SQL(assignee_id 필터) 경로로 전환된다.
_PERSONAL_QUESTION = "내가 맡은 업무 알려줘"


def _fake_embedding(text: str) -> list[float]:
    vector = [0.0] * _EMBEDDING_DIMENSIONS
    for axis, keyword in enumerate(_KEYWORD_AXES):
        if keyword in text:
            vector[axis] = 1.0
    if not any(vector):
        vector[_FALLBACK_AXIS] = 1.0
    return vector


@pytest.fixture
def rag_client(pgvector_pool, monkeypatch):
    """실제 풀에 연결된 RAG 엔드포인트 클라이언트 (구성 근거는 test_rag_indexing_integration.py)."""

    async def _override_pool():
        yield pgvector_pool

    app.dependency_overrides[get_pool] = _override_pool
    app.dependency_overrides[verify_internal_api_key] = lambda: None

    async def _embed(text: str) -> list[float]:
        return _fake_embedding(text)

    monkeypatch.setattr(ingestion_service, "embed_text", _embed)
    monkeypatch.setattr(chat_service, "embed_text", _embed)

    async def _generate(*_args, **_kwargs) -> str:
        return _ANSWER_STUB

    monkeypatch.setattr(chat_service, "generate_answer", _generate)

    # 큐 홉을 걷어내는 이유는 test_rag_indexing_integration.py의 같은 지점 주석에 있다.
    # 요약: /ai/rag/query는 Redis 스트림에 작업을 넣고 프로세스 밖 워커를 기다리므로,
    # 위 스텁이 무시되고 로컬 compose 워커가 자기 DB와 진짜 LLM으로 답을 만들어 준다.
    # 여기서는 특히 치명적이다 - "지운 것이 정말 지워졌는가"를 보는 파일인데, 답이 다른
    # DB에서 오면 삭제 검증이 통째로 무의미해진다.
    async def _answer_in_process(project_id, question, user_id, history=None, timeout=None):
        return await chat_service.answer_question(
            pgvector_pool, project_id, question, user_id, history=history or []
        )

    monkeypatch.setattr(chat_router, "enqueue_and_wait", _answer_in_process)

    # 캐시가 살아 있으면 색인을 바꿔도 이전 답변이 그대로 돌아와 변경 검증 자체가 성립하지
    # 않는다. 운영에서도 Redis 실패 시 캐시 없이 진행하므로 같은 경로를 탄다.
    def _no_redis():
        raise RuntimeError("통합 테스트에서는 답변 캐시를 사용하지 않는다")

    monkeypatch.setattr(chat_service, "get_async_redis_client", _no_redis)

    yield AsyncClient(transport=ASGITransport(app=app), base_url="http://rag-reindex-test")

    app.dependency_overrides.clear()


async def _create_project(pool, title: str) -> int:
    async with pool.acquire() as connection:
        return await connection.fetchval(
            "INSERT INTO projects (title, type) VALUES ($1, 'team') RETURNING id", title
        )


async def _create_user(pool, email: str) -> int:
    """document_chunks.assignee_id에 users(id) FK가 걸려 있어 실재하는 사용자가 필요하다."""
    async with pool.acquire() as connection:
        return await connection.fetchval(
            """
            INSERT INTO users (email, name, provider, provider_id)
            VALUES ($1, $1, 'local', $1)
            ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
            """,
            email,
        )


async def _ingest(
    client: AsyncClient,
    project_id: int,
    source_id: int,
    content: str,
    assignee_id: int | None = None,
    source_type: str = "task",
):
    return await client.post(
        "/ai/rag/ingest",
        json={
            "project_id": project_id,
            "source_type": source_type,
            "source_id": source_id,
            "content": content,
            "assignee_id": assignee_id,
        },
    )


async def _query(client: AsyncClient, project_id: int, question: str, user_id: int | None = None):
    payload: dict = {"project_id": project_id, "question": question}
    if user_id is not None:
        payload["user_id"] = user_id
    return await client.post("/ai/rag/query", json=payload)


async def _chunk_count(pool, project_id: int) -> int:
    async with pool.acquire() as connection:
        return await connection.fetchval(
            "SELECT count(*) FROM document_chunks WHERE project_id = $1", project_id
        )


@pytest.mark.asyncio
async def test_reingesting_a_source_replaces_the_old_content_instead_of_piling_up(
    pgvector_pool, rag_client
) -> None:
    """IT-040: 업무를 수정하고 재색인하면 질의에 이전 내용이 아닌 최신 내용만 나온다.

    ingest_content는 INSERT 앞에 같은 source의 기존 청크를 지운다. 그 DELETE가 빠지면
    같은 업무의 옛 버전과 새 버전이 동시에 검색되어, 사용자는 이미 고친 내용을 근거로 한
    답변을 받는다. 삭제가 실제로 일어나야만 통과하도록 두 가지를 함께 본다.

      - DB에 남은 청크가 1건인지 (누적되지 않았는가)
      - 질의가 돌려준 출처 본문이 최신 내용 하나뿐인지 (옛 내용이 검색되지 않는가)

    앞의 것만 보면 "지우지 않고 UPDATE로 덮는" 구현도 통과하므로 검색 결과까지 확인한다.
    """
    project_id = await _create_project(pgvector_pool, "IT-040 재색인")
    old_content = "결제 모듈 구현 - 카드 결제 연동을 먼저 끝낸다."
    new_content = "디자인 시안 검수 - 결제 화면 디자인을 확정한다."

    assert (await _ingest(rag_client, project_id, 5, old_content)).status_code == 200
    assert await _chunk_count(pgvector_pool, project_id) == 1

    assert (await _ingest(rag_client, project_id, 5, new_content)).status_code == 200

    assert await _chunk_count(pgvector_pool, project_id) == 1

    # 옛 내용과 새 내용 모두 "결제" 축을 공유하므로, 삭제가 빠졌다면 옛 청크도 상위에 함께
    # 잡힌다. 즉 이 질문은 두 버전을 유사도로 구분하지 못한다 - 오직 DELETE만이 결과를 가른다.
    response = await _query(rag_client, project_id, "결제 관련 업무 알려줘")

    assert response.status_code == 200
    snippets = [source["content_snippet"] for source in response.json()["sources"]]
    assert snippets == [new_content]


@pytest.mark.asyncio
async def test_assignee_sync_moves_the_task_out_of_the_previous_owner_personal_query(
    pgvector_pool, rag_client
) -> None:
    """IT-041: 담당자를 바꾸면 새 담당자의 개인화 질의에 나오고 이전 담당자에게서는 빠진다.

    sync_assignee는 임베딩을 다시 만들지 않고 assignee_id 컬럼만 UPDATE한다. 그래서 이
    동작은 벡터 유사도와 완전히 무관하다 - 질문도 문서도 그대로인데 결과가 바뀌어야 한다.
    UPDATE가 아무 행도 건드리지 못하면 옛 담당자의 "내 업무"에 남의 업무가 계속 뜬다.

    양방향을 모두 본다. 새 담당자에게 나오는 것만 보면, assignee_id 필터가 통째로 무시되는
    구현(모두에게 다 보임)도 통과해버린다.
    """
    project_id = await _create_project(pgvector_pool, "IT-041 담당자 동기화")
    previous_owner_id = await _create_user(pgvector_pool, "it041-previous@workflow.test")
    new_owner_id = await _create_user(pgvector_pool, "it041-new@workflow.test")

    assert (
        await _ingest(
            rag_client, project_id, 5, "배포 스크립트 정리 업무", assignee_id=previous_owner_id
        )
    ).status_code == 200

    before_previous = await _query(rag_client, project_id, _PERSONAL_QUESTION, previous_owner_id)
    before_new = await _query(rag_client, project_id, _PERSONAL_QUESTION, new_owner_id)
    assert _returned_sources(before_previous) == {("task", 5)}
    assert _returned_sources(before_new) == set()

    sync_response = await rag_client.post(
        "/ai/rag/assignee-sync",
        json={
            "project_id": project_id,
            "source_type": "task",
            "source_id": 5,
            "assignee_id": new_owner_id,
        },
    )
    assert sync_response.status_code == 204

    after_previous = await _query(rag_client, project_id, _PERSONAL_QUESTION, previous_owner_id)
    after_new = await _query(rag_client, project_id, _PERSONAL_QUESTION, new_owner_id)
    assert _returned_sources(after_new) == {("task", 5)}
    assert _returned_sources(after_previous) == set()


@pytest.mark.asyncio
async def test_deleting_one_project_index_leaves_the_other_project_intact(
    pgvector_pool, rag_client
) -> None:
    """IT-043: 프로젝트 인덱스를 정리해도 남은 프로젝트 질의가 영향을 받지 않는다.

    두 프로젝트에 완전히 같은 본문을 넣는 이유는 IT-030과 같다. 벡터가 동일해 유사도로는
    구분이 불가능하고, WHERE project_id 하나만이 삭제 범위와 검색 범위를 가른다. 본문을
    다르게 하면 범위가 잘못돼도 유사도 차이에 가려 통과할 수 있다.

    삭제된 쪽이 0건인 것과 남은 쪽이 그대로인 것을 함께 본다. 앞만 보면 전체 삭제도 통과한다.
    """
    shared_content = "배포 일정 공유와 배포 담당자 확인이 필요하다."
    deleted_project_id = await _create_project(pgvector_pool, "IT-043 삭제 대상")
    surviving_project_id = await _create_project(pgvector_pool, "IT-043 잔존")

    assert (await _ingest(rag_client, deleted_project_id, 77, shared_content)).status_code == 200
    assert (await _ingest(rag_client, surviving_project_id, 21, shared_content)).status_code == 200

    response = await rag_client.delete(f"/ai/rag/projects/{deleted_project_id}/sources")
    assert response.status_code == 204

    assert await _chunk_count(pgvector_pool, deleted_project_id) == 0
    assert await _chunk_count(pgvector_pool, surviving_project_id) == 1

    surviving_query = await _query(rag_client, surviving_project_id, "배포 일정 알려줘")
    assert _returned_sources(surviving_query) == {("task", 21)}

    # 삭제된 프로젝트로 질의하면 근거가 아예 없어야 한다. 남은 프로젝트의 동일 문서가
    # 여기로 새어 들어오면 삭제가 아니라 격리가 깨진 것이다.
    deleted_query = await _query(rag_client, deleted_project_id, "배포 일정 알려줘")
    assert _returned_sources(deleted_query) == set()


def _returned_sources(response) -> set[tuple[str, int]]:
    assert response.status_code == 200
    return {(source["source_type"], source["source_id"]) for source in response.json()["sources"]}
