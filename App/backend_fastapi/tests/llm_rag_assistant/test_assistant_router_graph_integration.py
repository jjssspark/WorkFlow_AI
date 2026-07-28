"""IT-032 어시스턴트 업무 조작 확인~실행 연계 (FastAPI 구간).

라우터와 그래프가 서로를 대역으로 두고 있어서 비어 있던 자리를 메운다.

    test_assistant_graph.py    start_command/resume_command를 직접 호출한다.
                               HTTP도 Pydantic 직렬화도 지나지 않는다.
    test_assistant_router.py   그 두 함수를 통째로 목으로 둔다.
                               그래프는 한 줄도 실행되지 않는다.

그래서 "HTTP로 명령을 넣으면 실제 그래프가 돌아 확인 카드가 응답 본문에 실려 나오고,
그 thread_id/step_id로 resume하면 완료 응답이 온다"는 문장은 한 번도 실행된 적이 없었다.
IT-032 명세가 요구하는 것이 정확히 이 문장이다.

대역은 둘뿐이다.

  plan_actions  - HF Inference API를 타는 LLM. 검증 대상은 계획의 품질이 아니라 배선이고,
                  LLM 출력이 매번 같다는 보장이 없어 테스트를 흔들기만 한다. 실물 LLM이
                  실제로 계획을 만드는지는 별도 1회 실측으로 확인한다(docs/trouble-shooting).
  embed_text    - 업무 지칭 해소용 임베딩. 어느 업무가 뽑히는지를 테스트가 정해야 결정론적이다.

나머지는 전부 실물이다. FastAPI 라우터, Pydantic 스키마, 컴파일된 LangGraph, InMemorySaver
체크포인터, interrupt/Command(resume) 왕복, 그리고 실제 pgvector 위의 업무 지칭 해소까지.

여기서 확인하지 않는 것: 실제 업무 변경. 그래프는 쓰기 API를 부르지 않는다
(assistant_graph._execute_node 주석 참조). 프론트가 자기 JWT로 Spring API를 호출해 쓰고,
그 결과만 resume으로 돌아온다. 그래서 이 테스트의 resume은 "프론트가 성공했다고 알려왔다"를
흉내내는 것이 맞다.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import InMemorySaver

from app.main import app
from core.db import get_pool
from llm_rag_assistant.app.graph import assistant_graph, task_resolver
from llm_rag_assistant.app.security import verify_internal_api_key
from llm_rag_assistant.app.services import ingestion_service

_EMBEDDING_DIMENSIONS = 1024
_KEYWORD_AXES = ("결제", "디자인", "배포")
_FALLBACK_AXIS = len(_KEYWORD_AXES)

_TARGET_TASK_ID = 42
_TARGET_TASK_CONTENT = "결제 모듈 구현 - 카드 결제 연동을 끝낸다."


def _fake_embedding(text: str) -> list[float]:
    vector = [0.0] * _EMBEDDING_DIMENSIONS
    for axis, keyword in enumerate(_KEYWORD_AXES):
        if keyword in text:
            vector[axis] = 1.0
    if not any(vector):
        vector[_FALLBACK_AXIS] = 1.0
    return vector


@pytest_asyncio.fixture
async def assistant_client(pgvector_pool, monkeypatch):
    """실제 그래프·실제 DB에 연결된 어시스턴트 엔드포인트 클라이언트."""

    async def _override_pool():
        yield pgvector_pool

    # clear()로 끝내면 app이 프로세스 전역이라 다른 모듈이 걸어둔 override까지 지운다.
    # 이 픽스처가 실패로 중단돼도 원래 상태로만 되돌리도록 스냅샷을 뜬다.
    original_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_pool] = _override_pool
    app.dependency_overrides[verify_internal_api_key] = lambda: None

    # get_graph는 컴파일된 그래프를 모듈 전역에 캐시한다. 그대로 두면 앞 테스트가 남긴
    # 체크포인트가 다음 테스트의 thread_id 조회에 걸린다. 테스트마다 새로 컴파일한다.
    compiled = assistant_graph._build().compile(checkpointer=InMemorySaver())

    async def _fresh_graph():
        return compiled

    monkeypatch.setattr(assistant_graph, "get_graph", _fresh_graph)

    async def _embed(text: str) -> list[float]:
        return _fake_embedding(text)

    monkeypatch.setattr(task_resolver, "embed_text", _embed)
    monkeypatch.setattr(ingestion_service, "embed_text", _embed)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://assistant-graph-test"
    ) as client:
        yield client

    app.dependency_overrides.clear()
    app.dependency_overrides.update(original_overrides)


def _plan(*actions):
    """plan_actions 대역. Action 객체 목록을 그대로 돌려준다."""

    async def _planned(_question, _history):
        return list(actions)

    return _planned


def _action(tool: str, task_ref: str, **args):
    from llm_rag_assistant.app.graph.state import Action

    return Action(tool=tool, task_ref=task_ref, args=args)


async def _seed_indexed_task(pool, project_id: int, task_id: int, content: str) -> None:
    """업무 지칭 해소는 document_chunks를 검색한다. 색인되지 않은 업무는 찾을 수 없다."""
    await ingestion_service.ingest_content(pool, project_id, "task", task_id, content)


async def _create_project(pool, title: str) -> int:
    async with pool.acquire() as connection:
        return await connection.fetchval(
            "INSERT INTO projects (title, type) VALUES ($1, 'team') RETURNING id", title
        )


def _ok(response):
    """200이 아니면 여기서 끊는다.

    본문만 보고 넘어가면 422(스키마 불일치)나 500(그래프 예외)이 "키가 없다"는
    엉뚱한 KeyError로 둔갑해, 진짜 원인이 응답 본문에 적혀 있는데도 안 보인다.
    """
    assert response.status_code == 200, f"{response.status_code}: {response.text}"
    return response.json()


async def _command(client: AsyncClient, project_id: int, question: str, role: str = "LEADER"):
    return _ok(await client.post(
        "/ai/assistant/command",
        json={
            "project_id": project_id,
            "question": question,
            "user_id": 7,
            "user_role": role,
            "history": [],
        },
    ))


async def _resume(client: AsyncClient, thread_id: str, step_id: str, ok: bool = True, error=None):
    return _ok(await client.post(
        "/ai/assistant/resume",
        json={"thread_id": thread_id, "step_id": step_id, "ok": ok, "error": error},
    ))


def test_wire_field_names_match_what_spring_sends_and_reads() -> None:
    """스프링 쪽 계약 테스트가 못 박아 둔 필드명을 이쪽에서도 못 박는다.

    FastApiAssistantClientWireContractTest는 자바가 만든 JSON을 자바 상수와 비교한다.
    그것만으로는 한쪽 방향의 드리프트를 못 잡는다. 여기 스키마를 고치고 자바를 안 고치면
    자바 테스트는 그대로 통과한다(자기 상수와 비교하니까). 그 반대도 마찬가지다.

    그래서 같은 필드 집합을 양쪽에 각각 못 박는다. 한쪽만 고치면 반대편 테스트가 깨져
    나머지 한쪽을 상기시킨다. 스키마 파일을 자바가 파싱하게 만드는 것보다 이쪽이 싸고,
    "두 파일을 같이 고쳐야 한다"는 사실 자체를 실패 메시지로 알려준다.

    두 파일은 서로를 주석으로 가리킨다:
      backend_spring/src/test/java/com/workflowai/assistant/FastApiAssistantClientWireContractTest.java
    """
    from llm_rag_assistant.app.schema.assistant_schema import (
        ActionCard,
        AssistantCommandRequest,
        AssistantResponse,
        AssistantResumeRequest,
    )

    # 나가는 방향 - 이름이 어긋나면 FastAPI가 422로 거부한다(스프링에서 503으로 위장됨).
    assert set(AssistantCommandRequest.model_fields) == {
        "project_id", "question", "user_id", "user_role", "history",
    }
    assert set(AssistantResumeRequest.model_fields) == {"thread_id", "step_id", "ok", "error"}

    # 돌아오는 방향 - 이름이 어긋나도 예외가 없다. 스프링에서 조용히 null이 되어
    # 확인 카드만 화면에서 사라진다.
    assert set(AssistantResponse.model_fields) == {
        "type", "message", "sources", "thread_id", "card",
    }
    assert set(ActionCard.model_fields) == {
        "step_id", "tool", "task_id", "title", "summary", "args",
    }


@pytest.mark.asyncio
async def test_command_returns_a_confirm_card_and_resume_completes_it(
    pgvector_pool, assistant_client, monkeypatch
) -> None:
    """IT-032: 확인 카드가 HTTP로 나오고, 그 카드로 resume하면 완료 응답이 온다.

    두 요청은 완전히 별개의 HTTP 호출이다. 그 사이를 잇는 것은 응답에 실려 나간 thread_id와
    체크포인터에 남은 interrupt 상태뿐이다. 카드만 확인하고 끝내면 그 이음매를 못 본다.
    """
    project_id = await _create_project(pgvector_pool, "IT-032 확인~실행")
    await _seed_indexed_task(pgvector_pool, project_id, _TARGET_TASK_ID, _TARGET_TASK_CONTENT)
    monkeypatch.setattr(
        assistant_graph,
        "plan_actions",
        _plan(_action("set_due_date", "결제 모듈 구현", date="2026-07-29")),
    )

    body = await _command(
        assistant_client, project_id, "결제 모듈 구현 업무 마감을 내일로 바꿔줘"
    )

    assert body["type"] == "confirm"
    card = body["card"]
    assert card is not None, "확인 카드가 없으면 프론트가 실행 버튼을 띄울 수 없다"
    assert card["tool"] == "set_due_date"
    # 지칭 해소가 실제 pgvector 검색으로 이뤄졌다는 증거. 이 값이 프론트가 호출할 업무를 정한다.
    assert card["task_id"] == _TARGET_TASK_ID
    assert card["args"] == {"date": "2026-07-29"}
    assert body["thread_id"]

    # 프론트가 Spring API로 실제 변경을 마치고 성공을 알려오는 지점이다.
    resumed = await _resume(assistant_client, body["thread_id"], card["step_id"])

    assert resumed["type"] == "done"
    assert resumed["message"] == "1개 작업을 완료했습니다."
    assert resumed["card"] is None


@pytest.mark.asyncio
async def test_each_step_of_a_multi_action_plan_needs_its_own_confirmation(
    pgvector_pool, assistant_client, monkeypatch
) -> None:
    """IT-032: 계획이 여러 단계면 단계마다 확인을 다시 받는다.

    HTTP 요청 네 번이 하나의 그래프 실행을 이어간다. 체크포인트가 요청 사이에서 살아남지
    못하면 두 번째 confirm이 나오지 않거나 스레드가 만료로 처리된다. 한 요청 안에서만
    도는 테스트로는 이 경계를 볼 수 없다.

    두 단계의 step_id가 서로 달라야 한다는 것도 함께 본다. 같으면 첫 승인 결과를 두 번째
    단계에 재사용할 수 있어, 사용자가 승인하지 않은 작업이 완료로 처리된다.
    """
    project_id = await _create_project(pgvector_pool, "IT-032 멀티액션")
    await _seed_indexed_task(pgvector_pool, project_id, _TARGET_TASK_ID, _TARGET_TASK_CONTENT)
    monkeypatch.setattr(
        assistant_graph,
        "plan_actions",
        _plan(
            _action("rename_task", "결제 모듈 구현", title="결제 연동 검수"),
            _action("set_due_date", "결제 모듈 구현", date="2026-07-30"),
        ),
    )

    first = await _command(
        assistant_client, project_id, "제목을 결제 연동 검수로 바꾸고 마감을 내일로 바꿔줘"
    )
    assert first["type"] == "confirm"
    assert first["card"]["tool"] == "rename_task"

    second = await _resume(assistant_client, first["thread_id"], first["card"]["step_id"])
    assert second["type"] == "confirm", "두 번째 단계도 승인을 다시 받아야 한다"
    assert second["card"]["tool"] == "set_due_date"
    assert second["card"]["step_id"] != first["card"]["step_id"]

    final = await _resume(assistant_client, first["thread_id"], second["card"]["step_id"])
    assert final["type"] == "done"
    assert final["message"] == "2개 작업을 완료했습니다."


@pytest.mark.asyncio
async def test_member_role_from_the_request_body_blocks_the_card(
    pgvector_pool, assistant_client, monkeypatch
) -> None:
    """IT-032: 팀장 전용 도구는 MEMBER에게 카드를 만들지 않는다.

    권한의 최종 방어선은 Spring의 @PreAuthorize지만, 여기서 막는 이유는 누르면 반드시
    실패할 버튼을 보여주지 않기 위해서다. 그 판정에 쓰이는 user_role은 요청 바디를 타고
    Pydantic Literal을 지나 그래프 상태까지 가야 한다. 중간에 값이 유실되면 기본값
    "MEMBER"로 떨어지는데, 그러면 팀장에게도 카드가 안 나온다(반대 방향 고장).

    그래서 같은 명령을 LEADER로도 보내 카드가 나오는지 함께 본다. 거부만 확인하면
    "무조건 거부"하는 구현도 통과한다.
    """
    project_id = await _create_project(pgvector_pool, "IT-032 권한")
    await _seed_indexed_task(pgvector_pool, project_id, _TARGET_TASK_ID, _TARGET_TASK_CONTENT)
    monkeypatch.setattr(
        assistant_graph,
        "plan_actions",
        _plan(_action("set_due_date", "결제 모듈 구현", date="2026-07-29")),
    )

    blocked = await _command(
        assistant_client, project_id, "결제 모듈 구현 업무 마감을 내일로 바꿔줘", role="MEMBER"
    )

    assert blocked["type"] == "done"
    assert blocked["card"] is None

    allowed = await _command(
        assistant_client, project_id, "결제 모듈 구현 업무 마감을 내일로 바꿔줘", role="LEADER"
    )

    assert allowed["type"] == "confirm"
    assert allowed["card"] is not None
