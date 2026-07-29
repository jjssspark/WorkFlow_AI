"""IT-029 RAG 색인~질의 연계 / IT-030 프로젝트 데이터 격리 연계.

FastAPI HTTP 엔드포인트에서 실제 pgvector까지 한 번에 태운다. 임베딩과 답변 생성만
대역으로 바꾸고, 그 사이의 청킹·벡터 직렬화·INSERT·유사도 검색·출처 조립은 전부 진짜다.

임베딩을 대역으로 두는 이유: 실제 모델(bge-m3 파인튜닝)은 첫 실행에 수 GB를 내려받고,
유사도 순위가 모델 버전에 따라 흔들려 테스트가 간헐적으로 실패한다. 여기서 검증하려는 건
모델의 품질이 아니라 "벡터가 DB를 왕복하고 프로젝트 경계가 지켜지는가"이므로, 어떤 문서가
더 가까운지를 테스트가 직접 정하는 편이 낫다. 차원은 운영과 같은 1024를 유지하므로
컬럼이 vector(1024)가 아니면 INSERT 단계에서 바로 실패한다.

대신 커버되지 않는 것: 실제 모델의 출력 차원이 컬럼 차원과 일치하는지. 그건 모델을 바꿀 때
확인해야 한다.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from core.db import get_pool
from core.security import verify_internal_api_key
from llm_rag_assistant.app.services import chat_service, ingestion_service

# 운영 컬럼 타입 vector(1024)와 같은 차원. 다르면 pgvector가 INSERT에서 거부한다.
_EMBEDDING_DIMENSIONS = 1024

# 각 키워드가 벡터의 서로 다른 축 하나를 차지한다. 같은 키워드를 담은 문서끼리는 완전히
# 같은 벡터가 되고, 다른 키워드끼리는 직교한다 - 유사도 순위가 결정론적이 된다.
_KEYWORD_AXES = ("배포", "결제", "디자인")
# 어느 키워드에도 걸리지 않는 텍스트용 축. 영벡터를 넣으면 pgvector의 코사인 거리가
# NaN이 되어 정렬 결과가 무의미해지므로 반드시 축 하나는 채운다.
_FALLBACK_AXIS = len(_KEYWORD_AXES)

_ANSWER_STUB = "테스트용 고정 답변"


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
    """실제 풀에 연결된 RAG 엔드포인트 클라이언트.

    TestClient 대신 ASGITransport를 쓰는 이유는 두 가지다. TestClient는 자체 이벤트 루프에서
    앱을 돌리므로 이 테스트의 루프에서 만든 asyncpg 풀을 넘기면 깨진다. 그리고 lifespan을
    실행하지 않아 기동 시 임베딩 모델 preload가 걸리지 않는다.
    """

    async def _override_pool():
        yield pgvector_pool

    app.dependency_overrides[get_pool] = _override_pool
    # 내부 키 검증은 test_rag_internal_auth.py가 따로 덮는다. 여기서는 그 뒤 경로가 관심사다.
    app.dependency_overrides[verify_internal_api_key] = lambda: None

    async def _embed(text: str) -> list[float]:
        return _fake_embedding(text)

    monkeypatch.setattr(ingestion_service, "embed_text", _embed)
    monkeypatch.setattr(chat_service, "embed_text", _embed)

    async def _generate(*_args, **_kwargs) -> str:
        return _ANSWER_STUB

    monkeypatch.setattr(chat_service, "generate_answer", _generate)

    # 로컬에 Redis가 떠 있으면 답변 캐시가 걸려 두 번째 실행이 DB를 안 탄다. 검증 대상이
    # 검색 경로이므로 캐시를 확실히 끈다(운영에서도 Redis 실패는 캐시 없이 진행한다).
    def _no_redis():
        raise RuntimeError("통합 테스트에서는 답변 캐시를 사용하지 않는다")

    monkeypatch.setattr(chat_service, "get_async_redis_client", _no_redis)

    transport = ASGITransport(app=app)
    yield AsyncClient(transport=transport, base_url="http://rag-integration-test")

    app.dependency_overrides.clear()


async def _create_project(pool, title: str) -> int:
    async with pool.acquire() as connection:
        return await connection.fetchval(
            "INSERT INTO projects (title, type) VALUES ($1, 'team') RETURNING id", title
        )


async def _ingest(client: AsyncClient, project_id: int, source_id: int, content: str):
    return await client.post(
        "/ai/rag/ingest",
        json={
            "project_id": project_id,
            "source_type": "meeting",
            "source_id": source_id,
            "content": content,
        },
    )


async def _query(client: AsyncClient, project_id: int, question: str):
    return await client.post("/ai/rag/query", json={"project_id": project_id, "question": question})


@pytest.mark.asyncio
async def test_ingested_document_is_retrievable_as_a_source_of_the_answer(pgvector_pool, rag_client) -> None:
    """IT-029: 색인한 문서가 질의 응답의 출처로 돌아온다.

    이 경로에서 실제로 실행되는 것들 - to_vector_literal이 만든 문자열의 pgvector 파싱,
    vector(1024) 컬럼 INSERT, embedding <=> $1::vector 코사인 검색, 출처 조립.
    지금까지는 어느 것도 실행된 적이 없었다(가짜 풀이 SQL을 삼켰다).
    """
    project_id = await _create_project(pgvector_pool, "IT-029 색인 연계")

    ingest_response = await _ingest(
        rag_client, project_id, 21, "이번 주 배포 일정과 배포 위험 업무를 점검했다."
    )

    assert ingest_response.status_code == 200
    assert ingest_response.json()["chunk_count"] == 1

    query_response = await _query(rag_client, project_id, "이번 주 배포 위험 업무는?")

    assert query_response.status_code == 200
    body = query_response.json()
    assert body["answer"] == _ANSWER_STUB
    assert len(body["sources"]) >= 1

    source = body["sources"][0]
    assert (source["source_type"], source["source_id"]) == ("meeting", 21)
    # 유사도가 DB에서 계산돼 왔다는 증거. 질문과 문서가 같은 축을 공유하므로 1.0에 가깝다.
    assert source["similarity"] == pytest.approx(1.0)
    assert "배포" in source["content_snippet"]


@pytest.mark.asyncio
async def test_query_never_returns_sources_from_another_project(pgvector_pool, rag_client) -> None:
    """IT-030: 다른 프로젝트에 완전히 같은 문서가 있어도 출처에 섞이지 않는다.

    두 문서의 본문을 같게 두는 것이 핵심이다. 임베딩이 완전히 동일해지므로 유사도만으로는
    둘을 구분할 수 없고, WHERE project_id = $2 하나만이 경계를 만든다. 본문을 다르게 하면
    격리가 깨져도 유사도 차이 때문에 통과해버려 테스트가 무의미해진다.
    """
    shared_content = "배포 일정 공유와 배포 담당자 확인이 필요하다."
    queried_project_id = await _create_project(pgvector_pool, "IT-030 질의 대상")
    other_project_id = await _create_project(pgvector_pool, "IT-030 타 프로젝트")

    assert (await _ingest(rag_client, queried_project_id, 21, shared_content)).status_code == 200
    assert (await _ingest(rag_client, other_project_id, 77, shared_content)).status_code == 200

    # 타 프로젝트 청크가 실제로 존재해야 격리 검증이 성립한다. 색인이 조용히 실패했는데
    # "안 나왔으니 통과"가 되는 상황을 막는다.
    async with pgvector_pool.acquire() as connection:
        other_project_chunks = await connection.fetchval(
            "SELECT count(*) FROM document_chunks WHERE project_id = $1", other_project_id
        )
    assert other_project_chunks == 1

    response = await _query(rag_client, queried_project_id, "배포 일정 알려줘")

    assert response.status_code == 200
    returned = {(source["source_type"], source["source_id"]) for source in response.json()["sources"]}
    assert returned == {("meeting", 21)}
