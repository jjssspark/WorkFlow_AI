from __future__ import annotations

import pytest

from llm_rag_assistant.app.services.retrieval_service import (
    TASK_CODE_MAX_SLOTS,
    search_chunks_for_question,
    search_similar_chunks,
)


class _FakeConn:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        return self._rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.mark.asyncio
async def test_search_uses_bound_parameters_not_string_concatenation() -> None:
    rows = [{"source_type": "meeting", "source_id": 1, "content": "내용", "similarity": 0.9}]
    conn = _FakeConn(rows)
    pool = _FakePool(conn)

    result = await search_similar_chunks(pool, project_id=7, query_embedding=[0.1, 0.2], top_k=5)

    assert result == rows
    query, args = conn.calls[0]
    # project_id, top_k가 SQL 문자열에 직접 삽입되지 않고 바인딩 파라미터로만 전달되는지 검증
    assert "7" not in query
    assert args == ("[0.10000000,0.20000000]", 7, 5)


@pytest.mark.asyncio
async def test_search_filters_by_project_id_parameter() -> None:
    conn = _FakeConn([])
    pool = _FakePool(conn)

    await search_similar_chunks(pool, project_id=99, query_embedding=[0.5], top_k=3)

    _, args = conn.calls[0]
    assert args[1] == 99


class _FakeSequenceConn:
    """호출 순서대로 다른 결과를 반환하는 fake conn (일반 검색 → 타입별 예약 검색 순서 검증용)."""

    def __init__(self, responses: list[list[dict]]) -> None:
        self._responses = responses
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        index = len(self.calls) - 1
        return self._responses[index]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSequencePool:
    def __init__(self, conn: _FakeSequenceConn) -> None:
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.mark.asyncio
async def test_search_reserves_meeting_slots_when_general_search_finds_none() -> None:
    general_rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9},
        {"source_type": "action_item", "source_id": 2, "content": "액션1", "similarity": 0.85},
        {"source_type": "task", "source_id": 3, "content": "업무2", "similarity": 0.8},
        {"source_type": "action_item", "source_id": 4, "content": "액션2", "similarity": 0.75},
        {"source_type": "task", "source_id": 5, "content": "업무3", "similarity": 0.7},
    ]
    meeting_rows = [
        {"source_type": "meeting", "source_id": 10, "content": "회의 요약", "similarity": 0.6},
    ]
    conn = _FakeSequenceConn([general_rows, meeting_rows])
    pool = _FakeSequencePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5)

    assert len(conn.calls) == 2
    assert any(row["source_type"] == "meeting" for row in result)
    assert len(result) == 5


@pytest.mark.asyncio
async def test_search_does_not_reserve_meeting_slots_when_already_present() -> None:
    general_rows = [
        {"source_type": "meeting", "source_id": 1, "content": "회의 요약", "similarity": 0.9},
        {"source_type": "task", "source_id": 2, "content": "업무1", "similarity": 0.8},
    ]
    conn = _FakeSequenceConn([general_rows])
    pool = _FakeSequencePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5)

    assert len(conn.calls) == 1
    assert result == general_rows


@pytest.mark.asyncio
async def test_search_skips_reservation_when_no_meeting_chunks_exist_at_all() -> None:
    general_rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9},
    ]
    conn = _FakeSequenceConn([general_rows, []])
    pool = _FakeSequencePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5)

    assert len(conn.calls) == 2
    assert result == general_rows


# --- 상위 K개 정렬 보장 (UT-194) -------------------------------------------
# 일반 검색만 타면 정렬·개수는 SQL의 ORDER BY/LIMIT가 책임진다. 하지만 meeting 슬롯
# 예약이 걸리면 두 결과를 파이썬에서 잘라 붙이므로, top_k 상한과 내림차순이 그 병합
# 경로에서도 유지되는지는 SQL이 보장해주지 않는다.


@pytest.mark.asyncio
async def test_merged_results_stay_sorted_by_similarity_desc() -> None:
    """예약된 meeting 청크가 뒤에 덧붙기만 하면 유사도 높은 근거가 목록 끝으로 밀린다.

    LLM 컨텍스트는 앞쪽 근거에 더 강하게 반응하므로 병합 후 반드시 재정렬돼야 한다.
    """
    general_rows = [
        {"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.90},
        {"source_type": "task", "source_id": 2, "content": "업무2", "similarity": 0.85},
        {"source_type": "action_item", "source_id": 3, "content": "액션1", "similarity": 0.80},
        {"source_type": "task", "source_id": 4, "content": "업무3", "similarity": 0.75},
        {"source_type": "task", "source_id": 5, "content": "업무4", "similarity": 0.70},
    ]
    meeting_rows = [
        {"source_type": "meeting", "source_id": 10, "content": "회의 요약", "similarity": 0.95},
        {"source_type": "meeting", "source_id": 11, "content": "회의 상세", "similarity": 0.60},
    ]
    conn = _FakeSequenceConn([general_rows, meeting_rows])

    result = await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=5)

    assert [row["similarity"] for row in result] == [0.95, 0.90, 0.85, 0.80, 0.60]
    assert result[0]["source_id"] == 10


@pytest.mark.asyncio
async def test_merged_results_never_exceed_top_k() -> None:
    """일반 결과 top_k개 + 예약 meeting개가 그대로 합쳐지면 상한을 넘는다.

    상한을 넘기면 프롬프트 길이가 예측 불가능해지고 토큰 비용이 조용히 늘어난다.
    """
    general_rows = [
        {"source_type": "task", "source_id": index, "content": f"업무{index}", "similarity": 0.9 - index / 100}
        for index in range(5)
    ]
    meeting_rows = [
        {"source_type": "meeting", "source_id": 10, "content": "회의1", "similarity": 0.5},
        {"source_type": "meeting", "source_id": 11, "content": "회의2", "similarity": 0.4},
    ]
    conn = _FakeSequenceConn([general_rows, meeting_rows])

    result = await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=5)

    assert len(result) == 5
    assert result == sorted(result, key=lambda row: row["similarity"], reverse=True)


@pytest.mark.asyncio
async def test_merged_results_respect_top_k_of_one() -> None:
    """top_k가 예약 슬롯 수(2)보다 작은 경계. 상한이 1이면 결과도 1건이어야 한다."""
    general_rows = [{"source_type": "task", "source_id": 1, "content": "업무1", "similarity": 0.9}]
    meeting_rows = [{"source_type": "meeting", "source_id": 10, "content": "회의1", "similarity": 0.5}]
    conn = _FakeSequenceConn([general_rows, meeting_rows])

    result = await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=1)

    assert len(result) == 1
    # 예약 검색에 넘기는 limit도 top_k를 넘지 않아야 한다.
    _, reserve_args = conn.calls[1]
    assert reserve_args[3] == 1


@pytest.mark.asyncio
async def test_top_k_is_passed_to_sql_limit_on_general_search() -> None:
    """병합이 없을 때는 SQL LIMIT이 상한을 책임진다 - top_k가 그대로 전달돼야 한다."""
    general_rows = [{"source_type": "meeting", "source_id": 1, "content": "회의", "similarity": 0.9}]
    conn = _FakeSequenceConn([general_rows])

    await search_similar_chunks(_FakeSequencePool(conn), project_id=1, query_embedding=[0.1], top_k=3)

    query, args = conn.calls[0]
    assert "ORDER BY embedding" in query
    assert "LIMIT" in query
    assert args[2] == 3


@pytest.mark.asyncio
async def test_search_filters_by_assignee_id_when_provided() -> None:
    assignee_rows = [{"source_type": "task", "source_id": 1, "content": "내 업무", "similarity": 0.9}]
    conn = _FakeConn(assignee_rows)
    pool = _FakePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5, assignee_id=42)

    assert result == assignee_rows
    query, args = conn.calls[0]
    assert "assignee_id" in query
    assert args == ("[0.10000000]", 1, 42, 5)


@pytest.mark.asyncio
async def test_search_does_not_fall_back_to_general_search_when_assignee_has_no_chunks() -> None:
    """담당 업무가 없을 때 프로젝트 전체 검색으로 대체하면 다른 사람의 업무가 컨텍스트에 섞여
    LLM이 그걸 질문자 본인의 담당 업무처럼 답할 수 있다 - 반드시 빈 결과를 그대로 반환해야 한다."""
    conn = _FakeConn([])
    pool = _FakePool(conn)

    result = await search_similar_chunks(pool, project_id=1, query_embedding=[0.1], top_k=5, assignee_id=42)

    assert result == []
    assert len(conn.calls) == 1


class _FakeRoutingConn:
    """SQL 모양으로 어떤 검색인지 구분해 응답을 돌려주는 fake.

    라우팅 경로는 코드 검색 -> 일반 검색 -> (필요 시) 회의록 예약 순으로 여러 번 질의한다.
    호출 순서에 기대면 예약 질의가 도는지 여부에 따라 테스트가 깨지므로 SQL로 구분한다.
    """

    def __init__(
        self,
        *,
        code: list[dict] | None = None,
        general: list[dict] | None = None,
        meeting: list[dict] | None = None,
        assignee: list[dict] | None = None,
        code_error: Exception | None = None,
    ) -> None:
        self.code = code if code is not None else []
        self.general = general if general is not None else []
        self.meeting = meeting if meeting is not None else []
        self.assignee = assignee if assignee is not None else []
        self.code_error = code_error
        self.calls: list[tuple] = []

    async def fetch(self, query: str, *args):
        self.calls.append((query, args))
        if "ANY($3::text[])" in query:
            if self.code_error is not None:
                raise self.code_error
            return self.code
        if "assignee_id" in query:
            return self.assignee
        if "source_type = $3" in query:
            return self.meeting
        return self.general

    def code_call(self) -> tuple | None:
        return next((call for call in self.calls if "ANY($3::text[])" in call[0]), None)

    def general_call(self) -> tuple | None:
        return next(
            (
                call
                for call in self.calls
                if "ANY($3::text[])" not in call[0]
                and "assignee_id" not in call[0]
                and "source_type = $3" not in call[0]
            ),
            None,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeRoutingPool:
    def __init__(self, conn: _FakeRoutingConn) -> None:
        self._conn = conn

    def acquire(self):
        return self._conn


def _row(source_type: str, source_id: int, content: str, similarity: float) -> dict:
    return {
        "source_type": source_type,
        "source_id": source_id,
        "content": content,
        "similarity": similarity,
    }


@pytest.mark.asyncio
async def test_question_without_a_task_code_keeps_the_current_vector_only_behaviour() -> None:
    """코드가 없는 질문의 순위는 손대지 않는다. 이게 라우팅이 회귀를 못 만드는 이유다."""
    general = [_row("task", 1, "업무1", 0.9), _row("meeting", 2, "회의 요약", 0.8)]
    conn = _FakeRoutingConn(general=general)

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "이번 주에 뭐 하기로 했지?", [0.1], top_k=5
    )

    assert result == general
    assert conn.code_call() is None


@pytest.mark.asyncio
async def test_personal_question_never_routes_even_when_a_task_code_is_present() -> None:
    """코드 정확 검색에는 담당자 필터가 없다. 라우팅하면 남의 담당 업무가 개인화 답변에 섞여
    LLM이 그걸 질문자 본인 것처럼 답할 수 있다."""
    assignee = [_row("task", 3, "내 업무", 0.9)]
    conn = _FakeRoutingConn(assignee=assignee, code=[_row("task", 99, "남의 WF-195", 0.5)])

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "내가 맡은 WF-195 어때?", [0.1], top_k=5, assignee_id=42
    )

    assert result == assignee
    assert conn.code_call() is None


@pytest.mark.asyncio
async def test_exact_code_hit_is_not_resorted_below_a_higher_scoring_vector_hit() -> None:
    """정확 일치 청크의 유사도가 임베딩 1등보다 낮은 것이 정상이다 - 질문과 겹치는 어휘가
    코드뿐이기 때문이다. 여기서 유사도로 재정렬하면 뒤로 밀려 잘려나가고, 라우팅한 의미가
    사라진다."""
    code = [_row("task", 195, "WF-195 결제 모듈 리팩터링", 0.30)]
    general = [
        _row("meeting", 7, "진행 상황이 어떻게 되고 있는지 공유드립니다", 0.90),
        _row("task", 8, "다른 업무", 0.85),
    ]
    conn = _FakeRoutingConn(code=code, general=general)

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-195 어떻게 돼가?", [0.1], top_k=5
    )

    assert result[0]["source_id"] == 195
    assert result[0]["similarity"] == 0.30


@pytest.mark.asyncio
async def test_vector_search_is_asked_for_the_full_top_k_not_just_the_leftover_slots() -> None:
    """잔여 칸 수로 줄여 부르면 회의록 예약이 남은 칸을 통째로 먹는다: top_k=2 이면
    reserved=min(MEETING_MIN_RESERVED, 2)=2 라 general[:0] 이 되어 의미 검색 결과가
    하나도 안 남는다. 그래서 항상 top_k 전체로 부르고 자르는 건 여기서 한다."""
    code = [_row("task", i, f"WF-{i} 업무", 0.5) for i in (1, 2, 3)]
    general = [_row("task", 10 + i, f"일반{i}", 0.9) for i in range(5)]
    conn = _FakeRoutingConn(code=code, general=general)

    await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-1 WF-2 WF-3 비교해줘", [0.1], top_k=5
    )

    general_call = conn.general_call()
    assert general_call is not None
    assert general_call[1][2] == 5


@pytest.mark.asyncio
async def test_code_slots_are_capped_so_vector_results_keep_room() -> None:
    """코드를 아무리 많이 물어도 상한까지만 받는다. 상한은 코드별이 아니라 전체 상한이라
    SQL LIMIT 인자로 그대로 넘어가야 한다."""
    conn = _FakeRoutingConn(code=[], general=[])

    await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-1 WF-2 WF-3 WF-4 WF-5 차이가 뭐야?", [0.1], top_k=5
    )

    code_call = conn.code_call()
    assert code_call is not None
    patterns, limit = code_call[1][2], code_call[1][3]
    assert len(patterns) == 5
    assert limit == TASK_CODE_MAX_SLOTS


@pytest.mark.asyncio
async def test_routed_result_never_exceeds_top_k() -> None:
    code = [_row("task", i, f"WF-{i} 업무", 0.5) for i in (1, 2, 3)]
    general = [_row("task", 10 + i, f"일반{i}", 0.9) for i in range(5)]
    conn = _FakeRoutingConn(code=code, general=general)

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-1 WF-2 WF-3 비교해줘", [0.1], top_k=5
    )

    assert len(result) == 5


@pytest.mark.asyncio
async def test_the_same_chunk_found_by_both_paths_appears_once() -> None:
    duplicate = _row("task", 195, "WF-195 결제 모듈", 0.30)
    conn = _FakeRoutingConn(
        code=[duplicate], general=[dict(duplicate), _row("task", 8, "다른 업무", 0.85)]
    )

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-195 어때?", [0.1], top_k=5
    )

    assert sum(1 for row in result if row["source_id"] == 195) == 1


@pytest.mark.asyncio
async def test_different_chunks_of_the_same_task_are_both_kept() -> None:
    """(source_type, source_id)만으로 중복을 지우면 긴 업무 설명이 여러 청크로 쪼개진 경우
    한 건으로 합쳐져 근거가 줄어든다. content까지 봐야 진짜 같은 청크만 사라진다."""
    conn = _FakeRoutingConn(
        code=[_row("task", 195, "WF-195 앞부분", 0.30)],
        general=[_row("task", 195, "WF-195 뒷부분", 0.80)],
    )

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-195 어때?", [0.1], top_k=5
    )

    assert len(result) == 2


@pytest.mark.asyncio
async def test_unknown_code_falls_back_to_vector_search_instead_of_giving_up() -> None:
    """명령 경로(task_resolver._resolve_by_code)와 반대 정책이다. 그쪽은 없는 코드를 억지
    매칭하면 엉뚱한 업무를 수정하게 되므로 '못 찾음'으로 끝낸다. 질문은 잘못 답해도 읽고
    무시하면 그만이라, 오타를 쳤을 때 아무것도 안 주는 편이 더 나쁘다."""
    general = [_row("meeting", 1, "회의 요약", 0.8)]
    conn = _FakeRoutingConn(code=[], general=general)

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-9999 어떻게 돼가?", [0.1], top_k=5
    )

    assert result == general


@pytest.mark.asyncio
async def test_code_lookup_failure_still_produces_an_answerable_result() -> None:
    """부가 경로가 본 기능을 죽이면 안 된다."""
    general = [_row("meeting", 1, "회의 요약", 0.8)]
    conn = _FakeRoutingConn(code_error=RuntimeError("코드 검색 실패"), general=general)

    result = await search_chunks_for_question(
        _FakeRoutingPool(conn), 1, "WF-195 어떻게 돼가?", [0.1], top_k=5
    )

    assert result == general


@pytest.mark.asyncio
async def test_code_patterns_use_the_same_boundaries_as_the_command_path() -> None:
    """뒤 경계가 [^0-9]로 느슨해지면 WF-195가 WF-195A에 오매칭돼 엉뚱한 업무를 근거로 준다."""
    conn = _FakeRoutingConn(code=[], general=[])

    await search_chunks_for_question(_FakeRoutingPool(conn), 1, "WF-195 어때?", [0.1], top_k=5)

    patterns = conn.code_call()[1][2]
    assert patterns == ["(^|[^0-9A-Za-z])WF-195([^0-9A-Za-z]|$)"]
