from __future__ import annotations

import json
import logging
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import (
    AnalyzeRequest,
    MeetingAnalysisResult,
    _analyze_json_uncached,
    analyze_meeting,
    analyze_json,
    analyze_meeting_with_huggingface,
    analyze_meeting_with_ollama,
    app,
    build_ollama_prompt,
    clean_todo_title,
    parse_ollama_analysis_response,
)
from core.security import verify_internal_api_key


@pytest.fixture(autouse=True)
def _bypass_internal_api_key():
    app.dependency_overrides[verify_internal_api_key] = lambda: None
    yield
    app.dependency_overrides.pop(verify_internal_api_key, None)


class FakeMeetingCache:
    def __init__(
        self,
        *,
        get_error: Exception | None = None,
        set_error: Exception | None = None,
        delete_error: Exception | None = None,
    ):
        self.values: dict[str, str] = {}
        self.set_calls: list[tuple[str, str, int | None]] = []
        self.deleted_keys: list[str] = []
        self.get_error = get_error
        self.set_error = set_error
        self.delete_error = delete_error

    def get(self, key: str) -> str | None:
        if self.get_error:
            raise self.get_error
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        if self.set_error:
            raise self.set_error
        self.values[key] = value
        self.set_calls.append((key, value, ex))

    def delete(self, key: str) -> None:
        if self.delete_error:
            raise self.delete_error
        self.deleted_keys.append(key)
        self.values.pop(key, None)


def _cache_test_result(request: AnalyzeRequest) -> MeetingAnalysisResult:
    return analyze_meeting(request)


def test_analyze_json_caches_by_every_result_determining_input(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "ollama")
    monkeypatch.setenv("MEETING_ANALYSIS_MODEL", "model-a")
    cache = FakeMeetingCache()
    monkeypatch.setattr("app.main.get_redis_client", lambda: cache)

    calls: list[AnalyzeRequest] = []

    def analyze_uncached(request: AnalyzeRequest) -> MeetingAnalysisResult:
        calls.append(request)
        return _cache_test_result(request)

    monkeypatch.setattr("app.main._analyze_json_uncached", analyze_uncached)
    base = AnalyzeRequest(
        project_id="project-a",
        title="캐시 회의",
        meeting_date="2026-07-23",
        text="김민준: 캐시를 구현한다.",
        participants=["김민준"],
        meeting_kind="정기회의",
        source_type="document",
    )

    assert analyze_json(base) == analyze_json(base)
    assert len(calls) == 1
    assert cache.set_calls[0][2] == 86400

    changed_requests = [
        base.model_copy(update={"project_id": "project-b"}),
        base.model_copy(update={"title": "다른 회의"}),
        base.model_copy(update={"meeting_date": "2026-07-24"}),
        base.model_copy(update={"text": "김민준: 다른 캐시를 구현한다."}),
        base.model_copy(update={"participants": ["이서연"]}),
        base.model_copy(update={"meeting_kind": "회고"}),
        base.model_copy(update={"source_type": "audio"}),
    ]
    for changed in changed_requests:
        analyze_json(changed)

    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    analyze_json(base)
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "ollama")
    monkeypatch.setenv("MEETING_ANALYSIS_MODEL", "model-b")
    analyze_json(base)

    assert len(calls) == 10
    assert len({key for key, _, _ in cache.set_calls}) == 10
    assert all(key.startswith("meeting_analysis:") for key, _, _ in cache.set_calls)


def test_analyze_json_cache_key_sorts_participant_copy_without_mutating_request(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    cache = FakeMeetingCache()
    monkeypatch.setattr("app.main.get_redis_client", lambda: cache)
    analyzed_requests: list[AnalyzeRequest] = []

    def analyze_uncached(request: AnalyzeRequest) -> MeetingAnalysisResult:
        analyzed_requests.append(request)
        return _cache_test_result(request)

    monkeypatch.setattr("app.main._analyze_json_uncached", analyze_uncached)
    first = AnalyzeRequest(text="회의", participants=["이서연", "김민준"])
    reordered = first.model_copy(update={"participants": ["김민준", "이서연"]})

    miss_result = analyze_json(first)
    hit_result = analyze_json(reordered)

    assert len(analyzed_requests) == 1
    assert analyzed_requests[0].participants == ["김민준", "이서연"]
    assert miss_result.meeting_meta.participants == ["김민준", "이서연"]
    assert hit_result.meeting_meta.participants == ["김민준", "이서연"]
    assert first.participants == ["이서연", "김민준"]
    assert reordered.participants == ["김민준", "이서연"]


@pytest.mark.parametrize(
    ("setting", "first_value", "second_value"),
    [
        ("OLLAMA_HOST", "http://ollama-a:11434", "http://ollama-b:11434"),
        ("MEETING_ANALYSIS_MODEL", "model-a", "model-b"),
        ("MEETING_ANALYSIS_TIMEOUT_SECONDS", "20", "21"),
        ("MEETING_ANALYSIS_MAX_CHARS", "6000", "5000"),
        ("MEETING_ANALYSIS_NUM_PREDICT", "650", "700"),
        ("MEETING_ANALYSIS_KEEP_ALIVE", "5m", "10m"),
        ("OLLAMA_ANALYSIS_TEMPERATURE", "0.1", "0.2"),
        ("HF_MEETING_ANALYSIS_ENDPOINT", "https://hf-a.example/v1", "https://hf-b.example/v1"),
        ("HF_MEETING_ANALYSIS_MODEL", "hf-model-a", "hf-model-b"),
        ("HF_MEETING_ANALYSIS_TIMEOUT_SECONDS", "35", "36"),
        ("HF_MEETING_ANALYSIS_MAX_TOKENS", "900", "901"),
        ("HF_MEETING_ANALYSIS_TEMPERATURE", "0.1", "0.2"),
        ("HF_TOKEN", "", "configured-test-token"),
    ],
)
def test_analyze_json_cache_misses_when_analysis_setting_changes(
    monkeypatch,
    setting,
    first_value,
    second_value,
):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    cache = FakeMeetingCache()
    monkeypatch.setattr("app.main.get_redis_client", lambda: cache)
    calls = 0

    def analyze_uncached(request: AnalyzeRequest) -> MeetingAnalysisResult:
        nonlocal calls
        calls += 1
        return _cache_test_result(request)

    monkeypatch.setattr("app.main._analyze_json_uncached", analyze_uncached)
    request = AnalyzeRequest(text="설정별 캐시 키 검증", participants=["김민준"])

    if setting == "HF_TOKEN":
        monkeypatch.delenv("HUGGINGFACEHUB_API_TOKEN", raising=False)
    monkeypatch.setenv(setting, first_value)
    analyze_json(request)
    monkeypatch.setenv(setting, second_value)
    analyze_json(request)

    assert calls == 2


@pytest.mark.parametrize("operation", ["client", "get", "set"])
def test_analyze_json_cache_errors_fail_open_with_safe_warning(monkeypatch, caplog, operation):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    request = AnalyzeRequest(
        title="캐시 장애 회의",
        meeting_date="2026-07-23",
        text="LOG-ME-NOT 회의 원문",
        participants=["김민준"],
    )
    expected = _cache_test_result(request)
    analyze_calls = 0

    def analyze_uncached(_: AnalyzeRequest) -> MeetingAnalysisResult:
        nonlocal analyze_calls
        analyze_calls += 1
        return expected

    monkeypatch.setattr("app.main._analyze_json_uncached", analyze_uncached)
    if operation == "client":
        monkeypatch.setattr("app.main.get_redis_client", lambda: (_ for _ in ()).throw(RuntimeError("client down")))
    else:
        cache = FakeMeetingCache(
            get_error=RuntimeError("get down") if operation == "get" else None,
            set_error=RuntimeError("set down") if operation == "set" else None,
        )
        monkeypatch.setattr("app.main.get_redis_client", lambda: cache)

    with caplog.at_level(logging.WARNING):
        result = analyze_json(request)

    assert result == expected
    assert analyze_calls == 1
    assert "LOG-ME-NOT" not in caplog.text
    assert "회의 원문" not in caplog.text
    assert caplog.records


def test_analyze_json_deletes_corrupt_cache_entry_and_replaces_it(monkeypatch, caplog):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    request = AnalyzeRequest(
        title="손상 캐시 회의",
        meeting_date="2026-07-23",
        text="CACHE-VALUE-MUST-NOT-BE-LOGGED",
        participants=["김민준"],
    )
    cache = FakeMeetingCache()
    monkeypatch.setattr("app.main.get_redis_client", lambda: cache)
    expected = _cache_test_result(request)
    monkeypatch.setattr("app.main._analyze_json_uncached", lambda _: expected)

    with patch("app.main._meeting_analysis_cache_key", return_value="meeting-analysis:test"):
        cache.values["meeting-analysis:test"] = "{CACHE-VALUE-MUST-NOT-BE-LOGGED"
        with caplog.at_level(logging.WARNING):
            result = analyze_json(request)

    assert result == expected
    assert cache.deleted_keys == ["meeting-analysis:test"]
    assert cache.set_calls[0][2] == 86400
    assert "CACHE-VALUE-MUST-NOT-BE-LOGGED" not in caplog.text


def test_analyze_json_continues_when_corrupt_cache_delete_fails(monkeypatch, caplog):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    request = AnalyzeRequest(text="DELETE-FAILURE-MUST-NOT-BE-LOGGED", participants=["김민준"])
    cache = FakeMeetingCache(delete_error=RuntimeError("delete down"))
    cache.values["meeting_analysis:test"] = "{invalid"
    monkeypatch.setattr("app.main.get_redis_client", lambda: cache)
    expected = _cache_test_result(request)
    monkeypatch.setattr("app.main._analyze_json_uncached", lambda _: expected)

    with patch("app.main._meeting_analysis_cache_key", return_value="meeting_analysis:test"):
        with caplog.at_level(logging.WARNING):
            result = analyze_json(request)

    assert result == expected
    assert cache.set_calls == [("meeting_analysis:test", expected.model_dump_json(), 86400)]
    assert "DELETE-FAILURE-MUST-NOT-BE-LOGGED" not in caplog.text


def test_extracts_assignee_candidate_from_meeting_text_instead_of_rotating_attendees():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="유소은은 API 문서를 정리한다. 김민준이 발표자료를 작성한다.",
        participants=["김민준", "이서연", "박지수", "최동혁"],
    )

    result = analyze_meeting(request)

    candidates = [todo.assignee_candidate for todo in result.todos]
    assert "유소은" not in candidates
    assert "김민준" in candidates
    assert "" in candidates


def test_leaves_assignee_candidate_empty_when_no_name_is_written_in_text():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="발표자료 초안 작성 논의를 진행했다.",
        participants=["김민준", "이서연"],
    )

    result = analyze_meeting(request)

    assert result.todos
    assert result.todos[0].assignee_candidate == ""


CAPSTONE_KICKOFF_TRANSCRIPT = """고무서: 전체 범위와 1주차 개발 목표를 정리하겠습니다.
곽진아: 인증과 권한 구조는 제가 먼저 잡겠습니다. Google OAuth 로그인, JWT 발급, 프로젝트별 팀장/팀원/심사자 권한을 7월 12일까지 기본 구조로 구현하겠습니다.
박지수: 저는 회의록 AI 분석을 맡겠습니다. 우선 문서 업로드 기반으로 회의 요약, 결정사항, 위험요소, To-Do 후보를 JSON으로 추출하는 기능부터 만들겠습니다.
허영주: 업무 보드는 네 개 상태로 가면 될 것 같습니다. 회의록에서 생성된 To-Do가 팀장 승인 후 업무 보드에 들어오게 연결하겠습니다.
유소은: 대시보드는 완료율, 마감 임박 업무, 블로커, 팀원별 업무량을 보여주겠습니다. ML 지연 위험도는 처음에는 규칙 기반으로 만들겠습니다.
박상준: AI Assistant는 RAG 구조로 설계하겠습니다.
이은주: 심사자 화면에서는 개인별 기여도 리포트와 AI 평가 근거를 볼 수 있게 하겠습니다.
곽진아: API 명세는 공통 응답 형식을 맞춰야 합니다.
박지수: 회의록 분석 결과는 summary, decisions, todos, risks, keywords 형식으로 고정하겠습니다.
"""


def test_extracts_speaker_name_as_assignee_candidate_from_name_colon_utterance_transcript():
    request = AnalyzeRequest(
        title="캡스톤디자인 WorkFlow AI 착수 회의",
        meeting_date="2026-07-09",
        meeting_kind="캡스톤디자인",
        text=CAPSTONE_KICKOFF_TRANSCRIPT,
        participants=["김민준", "이서연", "박지수", "최동혁"],
    )

    result = analyze_meeting(request)

    candidates = [todo.assignee_candidate for todo in result.todos]
    assert "박지수" in candidates
    for name in ["고무서", "곽진아", "허영주", "유소은", "박상준", "이은주"]:
        assert name not in candidates
    assert "" in candidates

    # 선택된 참석자/멤버 목록에 없는 사람의 업무는 미배정이어야 하고, 한 사람에게 몰리면 안 된다.
    assert candidates.count("박지수") < len(candidates)


def test_extracts_multiple_speakers_on_one_line_without_piling_on_first_speaker():
    request = AnalyzeRequest(
        title="연동 확인 회의",
        meeting_date="2026-07-20",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다. 김민준: 화면 로딩 표시를 개선하겠습니다.",
        participants=["박지수", "김민준"],
    )

    result = analyze_meeting(request)

    candidates = [todo.assignee_candidate for todo in result.todos]
    assert candidates == ["박지수", "김민준"]


def test_parse_ollama_analysis_response_builds_valid_result_from_json():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수", "김민준"],
    )
    raw = json.dumps(
        {
            "summary": "회의록 AI 분석 담당을 정했다.",
            "decisions": ["회의록 AI 분석은 박지수가 담당한다."],
            "todos": [
                {
                    "title": "회의록 AI 분석 구현",
                    "description": "회의록 AI 분석 기능을 구현한다.",
                    "assignee_candidate": "박지수",
                    "due_date": "2026-07-20",
                    "priority": "HIGH",
                    "category": "AI",
                }
            ],
            "risks": ["일정이 촉박할 수 있다."],
            "keywords": ["회의록 AI", "분석"],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.summary == "회의록 AI 분석 담당을 정했다."
    assert result.todos[0].assignee_candidate == "박지수"
    assert result.todos[0].assignee_id is None
    assert result.todos[0].needs_leader_review is True
    assert result.todos[0].category == "AI"


def test_parse_ollama_analysis_response_handles_markdown_code_fence():
    request = AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=[])
    raw = (
        "```json\n"
        + json.dumps({"summary": "요약", "decisions": [], "todos": [], "risks": [], "keywords": []})
        + "\n```"
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.summary == "요약"


def test_parse_ollama_analysis_response_rejects_hallucinated_assignee_name():
    """회의록 원문에 등장하지 않는 이름을 모델이 지어내더라도 담당자로 채택하지 않는다."""
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="발표자료 초안 작성 논의를 진행했다.",
        participants=["김민준", "이서연"],
    )
    raw = json.dumps(
        {
            "summary": "발표자료 작성 논의",
            "decisions": [],
            "todos": [
                {
                    "title": "발표자료 작성",
                    "description": "발표자료 초안을 작성한다.",
                    "assignee_candidate": "최동혁",
                    "priority": "MEDIUM",
                    "category": "PRESENTATION",
                }
            ],
            "risks": [],
            "keywords": [],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].assignee_candidate == ""


def test_parse_ollama_analysis_response_repairs_placeholder_todos_with_speaker_tasks():
    request = AnalyzeRequest(
        title="연동 확인 회의",
        meeting_date="2026-07-20",
        text=(
            "박지수: 저는 회의록 AI 분석을 맡겠습니다. 우선 문서 업로드 기반 요약과 To-Do 후보 추출을 구현하겠습니다.\n"
            "김민준: 저는 화면 로딩 표시를 개선하겠습니다."
        ),
        participants=["박지수", "김민준"],
    )
    raw = json.dumps(
        {
            "summary": "AI 분석과 화면 로딩 표시 개선을 진행한다.",
            "decisions": [],
            "todos": [
                {
                    "title": "업무 제목(간단히)",
                    "description": "AI 분석과 화면 로딩 표시 개선",
                    "assignee_candidate": "",
                    "priority": "HIGH",
                    "category": "AI",
                }
            ],
            "risks": [],
            "keywords": ["AI 분석"],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    candidates = [todo.assignee_candidate for todo in result.todos]
    assert "박지수" in candidates
    assert "김민준" in candidates
    assert all("업무 제목" not in todo.title for todo in result.todos)


def test_parse_ollama_analysis_response_normalizes_invalid_priority_and_category():
    request = AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=[])
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [
                {
                    "title": "업무",
                    "description": "설명",
                    "assignee_candidate": "",
                    "priority": "URGENT",
                    "category": "UNKNOWN",
                }
            ],
            "risks": [],
            "keywords": [],
        }
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].priority == "MEDIUM"
    assert result.todos[0].category == "ETC"


def test_parse_model_response_removes_hallucinated_due_date_and_decision_deadline():
    request = AnalyzeRequest(
        title="AI 분석 테스트 회의",
        meeting_date="2026-07-20",
        text="AI 분석 테스트 환경 구축 방향을 논의하고, 테스트 결과를 다음 회의에서 공유하기로 했다.",
        participants=["김민준", "이서연", "박지수", "최동혁"],
    )
    raw = json.dumps(
        {
            "summary": "AI 분석 테스트 환경 구축과 결과 공유를 논의했다.",
            "decisions": ["AI 분석 테스트 환경을 개발팀이 구축하여 2026-08-10까지 완료할 것"],
            "todos": [
                {
                    "title": "AI 분석 테스트 환경 구축",
                    "description": "AI 기반 분석 테스트를 위한 개발 환경을 설정한다.",
                    "assignee_candidate": "",
                    "due_date": "2026-08-10",
                    "priority": "HIGH",
                    "category": "BACKEND",
                }
            ],
            "risks": [],
            "keywords": ["AI 분석"],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].due_date is None
    assert all("2026-08-10" not in decision for decision in result.decisions)


def test_parse_model_response_keeps_due_date_only_when_deadline_exists_in_source():
    request = AnalyzeRequest(
        title="AI 분석 테스트 회의",
        meeting_date="2026-07-20",
        text="김민준은 8/10까지 AI 분석 테스트 환경을 구축하기로 했다.",
        participants=["김민준"],
    )
    raw = json.dumps(
        {
            "summary": "AI 분석 테스트 환경 구축 일정을 정했다.",
            "decisions": ["김민준이 AI 분석 테스트 환경을 2026-08-10까지 구축한다."],
            "todos": [
                {
                    "title": "AI 분석 테스트 환경 구축",
                    "description": "AI 분석 테스트 환경을 구축한다.",
                    "assignee_candidate": "김민준",
                    "due_date": "2026-08-10",
                    "priority": "HIGH",
                    "category": "BACKEND",
                }
            ],
            "risks": [],
            "keywords": ["AI 분석"],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].due_date == "2026-08-10"
    assert result.decisions == ["김민준이 AI 분석 테스트 환경을 2026-08-10까지 구축한다."]


def test_rule_based_analysis_does_not_invent_due_date_from_meeting_date():
    request = AnalyzeRequest(
        title="AI 분석 테스트 회의",
        meeting_date="2026-08-07",
        text="김민준: 저는 AI 분석 테스트 환경 구축을 진행하겠습니다.",
        participants=["김민준"],
    )

    result = analyze_meeting(request)

    assert result.todos[0].due_date is None


def test_parse_ollama_analysis_response_invalid_json_raises():
    request = AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=[])
    with pytest.raises(json.JSONDecodeError):
        parse_ollama_analysis_response("이건 JSON이 아닙니다", request)


def test_build_ollama_prompt_includes_assignee_rules_and_participants():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수", "김민준"],
    )

    prompt = build_ollama_prompt(request)

    assert "박지수" in prompt and "김민준" in prompt
    assert "빈 문자열" in prompt
    assert "임의 배정" in prompt
    assert "몰아서 배정" in prompt


def test_analyze_json_falls_back_to_rule_based_when_ollama_fails(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "ollama")
    client = TestClient(app)
    with patch("app.main.analyze_meeting_with_ollama", side_effect=RuntimeError("ollama down")):
        response = client.post(
            "/api/v1/meetings/analyze-json",
            json={
                "title": "정기회의",
                "meeting_date": "2026-07-15",
                "text": "발표자료 초안 작성 논의를 진행했다.",
                "participants": ["김민준"],
            },
        )

    assert response.status_code == 200
    assert response.json()["summary"]


def test_analyze_json_uses_rule_based_only_when_provider_is_rule(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    client = TestClient(app)
    with patch("app.main.analyze_meeting_with_ollama") as mock_ollama:
        response = client.post(
            "/api/v1/meetings/analyze-json",
            json={
                "title": "정기회의",
                "meeting_date": "2026-07-15",
                "text": "발표자료 초안 작성 논의를 진행했다.",
                "participants": ["김민준"],
            },
        )

    assert response.status_code == 200
    mock_ollama.assert_not_called()


def test_analyze_json_auto_skips_huggingface_when_token_is_missing(monkeypatch):
    monkeypatch.delenv("MEETING_ANALYSIS_PROVIDER", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACEHUB_API_TOKEN", raising=False)
    fake_result = analyze_meeting(
        AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=["김민준"])
    )
    client = TestClient(app)
    with (
        patch("app.main.analyze_meeting_with_huggingface") as mock_hf,
        patch("app.main.analyze_meeting_with_ollama", return_value=fake_result) as mock_ollama,
    ):
        response = client.post(
            "/api/v1/meetings/analyze-json",
            json={"title": "정기회의", "meeting_date": "2026-07-15", "text": "내용", "participants": ["김민준"]},
        )

    assert response.status_code == 200
    mock_hf.assert_not_called()
    mock_ollama.assert_called_once()


def test_analyze_upload_invalid_pdf_returns_422_instead_of_empty_analysis(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "rule")
    client = TestClient(app)

    response = client.post(
        "/api/v1/meetings/analyze",
        data={"title": "깨진 PDF 회의록"},
        files={"file": ("broken.pdf", b"not a real pdf", "application/pdf")},
    )

    assert response.status_code == 422
    assert "PDF" in response.json()["detail"]


def test_analyze_json_uses_ollama_result_when_available(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "ollama")
    fake_result = analyze_meeting(
        AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=["김민준"])
    )
    client = TestClient(app)
    with patch("app.main.analyze_meeting_with_ollama", return_value=fake_result) as mock_ollama:
        response = client.post(
            "/api/v1/meetings/analyze-json",
            json={"title": "정기회의", "meeting_date": "2026-07-15", "text": "내용", "participants": ["김민준"]},
        )

    assert response.status_code == 200
    mock_ollama.assert_called_once()


def test_analyze_json_uses_huggingface_result_when_provider_is_huggingface(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "huggingface")
    fake_result = analyze_meeting(
        AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=["김민준"])
    )
    client = TestClient(app)
    with patch("app.main.analyze_meeting_with_huggingface", return_value=fake_result) as mock_hf:
        response = client.post(
            "/api/v1/meetings/analyze-json",
            json={"title": "정기회의", "meeting_date": "2026-07-15", "text": "내용", "participants": ["김민준"]},
        )

    assert response.status_code == 200
    mock_hf.assert_called_once()


def test_analyze_json_falls_back_to_ollama_when_huggingface_fails(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "huggingface")
    fake_result = analyze_meeting(
        AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="내용", participants=["김민준"])
    )
    client = TestClient(app)
    with (
        patch("app.main.analyze_meeting_with_huggingface", side_effect=RuntimeError("hf down")),
        patch("app.main.analyze_meeting_with_ollama", return_value=fake_result) as mock_ollama,
    ):
        response = client.post(
            "/api/v1/meetings/analyze-json",
            json={"title": "정기회의", "meeting_date": "2026-07-15", "text": "내용", "participants": ["김민준"]},
        )

    assert response.status_code == 200
    mock_ollama.assert_called_once()


def test_analyze_json_fallback_warnings_do_not_expose_exception_details(monkeypatch, caplog):
    monkeypatch.setenv("MEETING_ANALYSIS_PROVIDER", "huggingface")
    monkeypatch.setenv("HF_TOKEN", "configured-test-token")
    request = AnalyzeRequest(
        title="보안 로그 회의",
        meeting_date="2026-07-23",
        text="민감한 회의 원문",
        participants=["김민준"],
    )
    sentinel = "https://admin:credential-sentinel@private.example/model"

    with (
        patch("app.main.analyze_meeting_with_huggingface", side_effect=RuntimeError(sentinel)),
        patch("app.main.analyze_meeting_with_ollama", side_effect=RuntimeError(sentinel)),
        caplog.at_level(logging.WARNING),
    ):
        result = _analyze_json_uncached(request)

    assert result.summary
    assert "errorType=RuntimeError" in caplog.text
    assert "credential-sentinel" not in caplog.text
    assert "private.example" not in caplog.text
    assert "민감한 회의 원문" not in caplog.text


def test_analyze_meeting_with_ollama_uses_fast_default_model_and_bounded_options(monkeypatch):
    monkeypatch.delenv("MEETING_ANALYSIS_MODEL", raising=False)
    monkeypatch.delenv("MEETING_ANALYSIS_TIMEOUT_SECONDS", raising=False)
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-20",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수"],
    )
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [],
            "risks": [],
            "keywords": [],
        }
    )

    class FakeClient:
        def __init__(self, host: str, timeout: float):
            self.host = host
            self.timeout = timeout
            self.chat_kwargs = None

        def list(self):
            return {"models": [{"name": "qwen2.5:1.5b"}]}

        def chat(self, **kwargs):
            self.chat_kwargs = kwargs
            return {"message": {"content": raw}}

    fake_client = FakeClient("http://localhost:11434", 20)
    with patch("app.main.ollama.Client", return_value=fake_client):
        result = analyze_meeting_with_ollama(request)

    assert result.summary == "요약"
    assert fake_client.timeout == 20.0
    assert fake_client.chat_kwargs["model"] == "qwen2.5:1.5b"
    assert fake_client.chat_kwargs["options"]["num_predict"] == 650
    assert fake_client.chat_kwargs["keep_alive"] == "5m"


def test_analyze_meeting_with_ollama_fails_fast_when_model_is_missing(monkeypatch):
    monkeypatch.setenv("MEETING_ANALYSIS_MODEL", "llama3.2:3b")
    request = AnalyzeRequest(title="정기회의", meeting_date="2026-07-20", text="내용", participants=[])

    class FakeClient:
        def list(self):
            return {"models": [{"name": "gemma4:e2b"}]}

        def chat(self, **kwargs):
            raise AssertionError("missing model should not call chat")

    with patch("app.main.ollama.Client", return_value=FakeClient()):
        with pytest.raises(RuntimeError):
            analyze_meeting_with_ollama(request)


def test_analyze_meeting_with_huggingface_uses_openai_compatible_router(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")
    monkeypatch.delenv("HUGGINGFACEHUB_API_TOKEN", raising=False)
    monkeypatch.delenv("HF_MEETING_ANALYSIS_MODEL", raising=False)
    monkeypatch.delenv("HF_MEETING_ANALYSIS_ENDPOINT", raising=False)
    monkeypatch.delenv("HF_MEETING_ANALYSIS_TIMEOUT_SECONDS", raising=False)
    monkeypatch.delenv("HF_MEETING_ANALYSIS_MAX_TOKENS", raising=False)
    monkeypatch.delenv("HF_MEETING_ANALYSIS_TEMPERATURE", raising=False)
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-20",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수"],
    )
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [],
            "risks": [],
            "keywords": [],
        }
    )
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": raw}}]}

    class FakeClient:
        def __init__(self, timeout: float):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def post(self, endpoint: str, headers: dict, json: dict):
            captured["endpoint"] = endpoint
            captured["headers"] = headers
            captured["json"] = json
            captured["timeout"] = self.timeout
            return FakeResponse()

    with patch("app.main.httpx.Client", FakeClient):
        result = analyze_meeting_with_huggingface(request)

    assert result.summary == "요약"
    assert captured["endpoint"] == "https://router.huggingface.co/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer hf_test_token"
    assert captured["json"]["model"] == "Qwen/Qwen3-4B-Instruct-2507"
    assert captured["json"]["max_tokens"] == 900
    assert captured["json"]["stream"] is False
    assert captured["timeout"] == 35.0


def test_analyze_meeting_with_huggingface_requires_token(monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACEHUB_API_TOKEN", raising=False)
    request = AnalyzeRequest(title="정기회의", meeting_date="2026-07-20", text="내용", participants=[])

    with pytest.raises(RuntimeError):
        analyze_meeting_with_huggingface(request)


def test_parse_model_response_removes_assignee_without_task_evidence():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-20",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.\n김민준: 발표자료 준비를 하겠습니다.\n결정사항은 문서 업로드 기반 분석을 먼저 구현하는 것입니다.",
        participants=["박지수", "김민준"],
    )
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": ["문서 업로드 기반 분석을 먼저 구현한다."],
            "todos": [
                {
                    "title": "발표자료 준비",
                    "description": "발표자료 준비를 하겠습니다.",
                    "assignee_candidate": "김민준",
                    "priority": "HIGH",
                    "category": "PRESENTATION",
                },
                {
                    "title": "결정사항은 문서 업로드 기반 분석을 먼저 구현하는 것입니다",
                    "description": "문서 업로드 기반 분석을 먼저 구현한다.",
                    "assignee_candidate": "김민준",
                    "priority": "MEDIUM",
                    "category": "AI",
                },
            ],
            "risks": [],
            "keywords": [],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].assignee_candidate == "김민준"
    assert result.todos[1].assignee_candidate == ""


def test_parse_model_response_fills_missing_assignee_from_speaker_evidence():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-20",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.\n김민준: 발표자료 준비를 하겠습니다.",
        participants=["박지수", "김민준"],
    )
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [
                {
                    "title": "회의록 AI 분석",
                    "description": "회의록 분석 기능을 구현한다.",
                    "assignee_candidate": "박지수",
                    "priority": "HIGH",
                    "category": "AI",
                },
                {
                    "title": "발표자료 준비",
                    "description": "회의 내용을 바탕으로 발표 자료를 작성한다.",
                    "assignee_candidate": "",
                    "priority": "MEDIUM",
                    "category": "PRESENTATION",
                },
            ],
            "risks": [],
            "keywords": [],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].assignee_candidate == "박지수"
    assert result.todos[1].assignee_candidate == "김민준"


def test_ollama_response_does_not_pile_all_todos_on_one_person():
    """캡스톤 착수 회의 시나리오: Ollama가 각 발언자의 담당 발언만 assignee_candidate로 채택하고,
    박지수에게 모든 업무가 몰리지 않아야 한다. 담당자 불명확 업무는 미배정이어야 한다."""
    request = AnalyzeRequest(
        title="캡스톤디자인 WorkFlow AI 착수 회의",
        meeting_date="2026-07-09",
        text=CAPSTONE_KICKOFF_TRANSCRIPT,
        participants=["김민준", "이서연", "박지수", "최동혁"],
    )
    raw = json.dumps(
        {
            "summary": "각 파트 담당자와 착수 목표를 정리했다.",
            "decisions": ["회의록 분석 결과는 summary, decisions, todos, risks, keywords 형식으로 고정한다."],
            "todos": [
                {
                    "title": "인증/권한 구조",
                    "description": "인증과 권한 구조를 잡는다.",
                    "assignee_candidate": "곽진아",
                    "priority": "HIGH",
                    "category": "BACKEND",
                },
                {
                    "title": "회의록 AI 분석",
                    "description": "회의록 AI 분석을 맡는다.",
                    "assignee_candidate": "박지수",
                    "priority": "HIGH",
                    "category": "AI",
                },
                {
                    "title": "업무 보드 상태",
                    "description": "업무 보드는 네 개 상태로 구성한다.",
                    "assignee_candidate": "허영주",
                    "priority": "MEDIUM",
                    "category": "FRONTEND",
                },
                {
                    "title": "대시보드 지표",
                    "description": "완료율과 마감 임박 업무를 보여준다.",
                    "assignee_candidate": "유소은",
                    "priority": "MEDIUM",
                    "category": "FRONTEND",
                },
                {
                    "title": "AI Assistant RAG 설계",
                    "description": "AI Assistant는 RAG 구조로 설계한다.",
                    "assignee_candidate": "박상준",
                    "priority": "MEDIUM",
                    "category": "AI",
                },
                {
                    "title": "심사자 기여도 리포트",
                    "description": "심사자 화면에서 개인별 기여도 리포트를 보여준다.",
                    "assignee_candidate": "이은주",
                    "priority": "MEDIUM",
                    "category": "FRONTEND",
                },
                {
                    "title": "API 명세 정리",
                    "description": "API 명세는 공통 응답 형식을 맞춰야 한다.",
                    "assignee_candidate": "",
                    "priority": "LOW",
                    "category": "BACKEND",
                },
            ],
            "risks": [],
            "keywords": ["캡스톤", "회의록 AI"],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    candidates = [todo.assignee_candidate for todo in result.todos]
    assert candidates.count("박지수") >= 1
    assert candidates.count("박지수") < len(candidates)
    assert "" in candidates  # 담당자 불명확 또는 선택 참석자/멤버가 아닌 업무는 미배정으로 남는다
    for name in ["곽진아", "허영주", "유소은", "박상준", "이은주"]:
        assert name not in candidates
    for todo in result.todos:
        assert todo.assignee_id is None
        assert todo.needs_leader_review is True


def test_clean_todo_title_strips_speech_act_phrasing():
    assert clean_todo_title("저는 회의록 AI 분석을 맡겠습니다") == "회의록 AI 분석"
    cleaned = clean_todo_title("김민준이 발표자료를 작성하겠습니다")
    assert cleaned == "발표자료 작성"
    assert "하겠습니다" not in cleaned


def test_clean_todo_title_shortens_overly_long_titles():
    long_title = "임베딩 모델을 바꾸는 방향으로 진행하면서 성능 테스트까지 함께 진행하겠습니다"
    cleaned = clean_todo_title(long_title)
    assert len(cleaned) <= 25


def test_clean_todo_title_keeps_already_clean_noun_phrase_unchanged():
    assert clean_todo_title("임베딩 모델 변경") == "임베딩 모델 변경"


def test_build_todos_title_is_not_a_raw_verbatim_quote():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수"],
    )

    result = analyze_meeting(request)

    assert result.todos[0].title != "저는 회의록 AI 분석을 맡겠습니다"
    assert "하겠습니다" not in result.todos[0].title
    assert "맡겠습니다" not in result.todos[0].title


def test_build_todos_sets_evidence_text_with_speaker_quote():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수"],
    )

    result = analyze_meeting(request)

    assert result.todos[0].evidence_text == "박지수: 저는 회의록 AI 분석을 맡겠습니다"


def test_parse_ollama_analysis_response_cleans_title_and_keeps_valid_evidence():
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수"],
    )
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [
                {
                    "title": "저는 회의록 AI 분석을 맡겠습니다",
                    "description": "회의록 AI 분석 기능을 구현한다.",
                    "assignee_candidate": "박지수",
                    "priority": "HIGH",
                    "category": "AI",
                    "evidence_text": "박지수: 저는 회의록 AI 분석을 맡겠습니다.",
                }
            ],
            "risks": [],
            "keywords": [],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].title != "저는 회의록 AI 분석을 맡겠습니다"
    assert "하겠습니다" not in result.todos[0].title
    assert result.todos[0].evidence_text == "박지수: 저는 회의록 AI 분석을 맡겠습니다."


def test_parse_ollama_analysis_response_rejects_evidence_not_in_source_text():
    """LLM이 회의록 원문에 없는 근거 문구를 지어내면, 원문에서 실제로 근거를 찾아 대체한다."""
    request = AnalyzeRequest(
        title="정기회의",
        meeting_date="2026-07-15",
        text="박지수: 저는 회의록 AI 분석을 맡겠습니다.",
        participants=["박지수"],
    )
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [
                {
                    "title": "회의록 AI 분석 구현",
                    "description": "회의록 AI 분석 기능을 구현한다.",
                    "assignee_candidate": "박지수",
                    "priority": "HIGH",
                    "category": "AI",
                    "evidence_text": "이 문장은 회의록 원문에 존재하지 않는다",
                }
            ],
            "risks": [],
            "keywords": [],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert "이 문장은 회의록 원문에 존재하지 않는다" not in result.todos[0].evidence_text
    assert "박지수" in result.todos[0].evidence_text


def test_parse_ollama_analysis_response_defaults_evidence_to_empty_when_no_match_found():
    request = AnalyzeRequest(title="정기회의", meeting_date="2026-07-15", text="특별한 내용 없음.", participants=[])
    raw = json.dumps(
        {
            "summary": "요약",
            "decisions": [],
            "todos": [
                {
                    "title": "임의 업무",
                    "description": "관련 없는 임의 설명",
                    "assignee_candidate": "",
                    "priority": "LOW",
                    "category": "ETC",
                }
            ],
            "risks": [],
            "keywords": [],
        },
        ensure_ascii=False,
    )

    result = parse_ollama_analysis_response(raw, request)

    assert result.todos[0].evidence_text == ""


def test_rule_based_analysis_extracts_formal_followup_tasks_from_meeting_minutes():
    text = """
회의록
회의제목 캡스톤디자인 WorkFlow AI 회의록 분석 기능 점검 회의
참석자 김민준, 이서연, 박지수, 최동혁
논의 내용
김민준은 회의 시작과 함께 회의록 업로드 후 분석 결과가 프로젝트 단위로 관리되어야 한다고 설명하였다.
박지수는 분석 상태 폴링과 실패 시 재시도 흐름을 다시 점검해보겠다고 말했다.
이서연은 업무 후보가 실제 업무보드에 등록될 때 등록 중 상태가 보여야 한다고 하였다.
최동혁은 심사자 화면에서 기여도 근거 문장이 함께 보이는지 확인해보겠다고 말했다.
추후 일정
다음 회의 전까지 김민준은 프로젝트별 회의록 접근 권한과 삭제 권한을 확인하고,
박지수는 회의록 AI 분석 상태 표시와 담당자 검증 로직을 점검한다.
이서연은 업무 후보 등록 후 업무보드 반영 흐름을 확인하고,
최동혁은 심사자 기여도 분석 화면에서 근거 문장 표시 여부를 검토한다.
작성자 박지수
"""
    request = AnalyzeRequest(
        title="캡스톤디자인 WorkFlow AI 회의록 분석 기능 점검 회의",
        meeting_date="2026-07-20",
        text=text,
        participants=["김민준", "이서연", "박지수", "최동혁"],
    )

    result = analyze_meeting(request)

    assert [todo.assignee_candidate for todo in result.todos] == ["김민준", "박지수", "이서연", "최동혁"]
    titles = [todo.title for todo in result.todos]
    assert "프로젝트별 회의록 접근 권한과 삭제 권한 확인" in titles
    assert any(title.startswith("회의록 AI 분석 상태 표시와 담당자 검증") for title in titles)
    assert "업무 후보 등록 후 업무보드 반영 흐름 확인" in titles
    assert any(title.startswith("심사자 기여도 분석 화면에서 근거 문장 표시") for title in titles)
    assert all(todo.evidence_text for todo in result.todos)
