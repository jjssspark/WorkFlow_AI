"""양식 기반 섹션 분석 테스트.

Spring이 회의록 양식을 인식하면 AnalyzeRequest.sections를 채워 보낸다. 그때 결정사항·위험요소·To-Do가
전체 텍스트 키워드 추측이 아니라 해당 섹션 안에서만 나와야 한다.
"""

from app.main import (
    AnalyzeRequest,
    sanitize_model_statements,
    parse_action_items,
    MeetingSections,
    _meeting_analysis_cache_key,
    analyze_meeting,
    build_section_hint,
)

FULL_TEXT = "\n".join([
    "2. 논의 내용",
    "결제 모듈 진행 상황을 공유했다. 일정이 촉박하다는 이야기가 나왔다.",
    "3. 결정 사항",
    "PG사는 A사로 간다.",
    "4. 액션 아이템",
    "김민준이 결제 연동 코드를 작성한다.",
    "5. 특이사항 · 리스크",
    "테스트 계정 발급이 늦어지고 있다.",
])

SECTIONS = MeetingSections(
    discussion="결제 모듈 진행 상황을 공유했다. 일정이 촉박하다는 이야기가 나왔다.",
    decisions="PG사는 A사로 간다.",
    todos="김민준이 결제 연동 코드를 작성한다.",
    issues="테스트 계정 발급이 늦어지고 있다.",
)


def _request(**overrides) -> AnalyzeRequest:
    base = {
        "title": "7차 정기회의",
        "meeting_date": "2026-08-02",
        "text": FULL_TEXT,
        "participants": ["김민준", "이서연"],
    }
    base.update(overrides)
    return AnalyzeRequest(**base)


def test_decisions_come_only_from_decisions_section():
    result = analyze_meeting(_request(sections=SECTIONS))

    assert result.decisions == ["PG사는 A사로 간다"]


def test_risks_come_only_from_issues_section():
    result = analyze_meeting(_request(sections=SECTIONS))

    assert result.risks == ["테스트 계정 발급이 늦어지고 있다"]


def test_keyword_path_would_have_picked_up_discussion_noise():
    """섹션이 없으면 논의 문단의 '촉박'이 위험요소로 잡힌다 — 섹션 지정이 이를 막는다."""
    without_sections = analyze_meeting(_request())

    assert any("촉박" in risk for risk in without_sections.risks)

    with_sections = analyze_meeting(_request(sections=SECTIONS))

    assert not any("촉박" in risk for risk in with_sections.risks)


def test_empty_section_falls_back_to_keyword_extraction():
    partial = MeetingSections(
        discussion=SECTIONS.discussion,
        decisions="",
        todos=SECTIONS.todos,
        issues=SECTIONS.issues,
    )

    result = analyze_meeting(_request(sections=partial))

    # 결정 사항 섹션만 비었으므로 그 항목만 전체 텍스트 키워드 경로로 폴백한다.
    assert result.decisions
    assert result.risks == ["테스트 계정 발급이 늦어지고 있다"]


def test_request_without_sections_keeps_existing_behaviour():
    result = analyze_meeting(_request())

    assert result.decisions
    assert result.risks
    assert result.meeting_meta.title == "7차 정기회의"


def test_cache_key_differs_when_sections_present():
    assert _meeting_analysis_cache_key(_request()) != _meeting_analysis_cache_key(
        _request(sections=SECTIONS)
    )


def test_section_hint_is_empty_without_sections():
    assert build_section_hint(None) == ""
    assert build_section_hint(MeetingSections()) == ""


def test_section_hint_labels_each_filled_section():
    hint = build_section_hint(SECTIONS)

    assert "[결정 사항]" in hint
    assert "[특이사항·리스크]" in hint
    assert "PG사는 A사로 간다." in hint


# ── 양식 표의 우선순위 체크 ──────────────────────────────────────────────────

TABLE_TODOS = "\n".join([
    "[v] 긴급 [ ] 보통 [ ] 낮음",
    "김민준이 결제 API 연동을 8/10까지 마무리한다.",
    "[ ] 긴급 [ ] 보통 [v] 낮음",
    "이서연이 테스트 코드를 다음 주까지 작성한다.",
    "[ ] 긴급 [ ] 보통 [ ] 낮음",
])


def test_parse_action_items_pairs_priority_with_content():
    items = parse_action_items(TABLE_TODOS)

    assert items == [
        ("HIGH", "김민준이 결제 API 연동을 8/10까지 마무리한다."),
        ("LOW", "이서연이 테스트 코드를 다음 주까지 작성한다."),
    ]


def test_parse_action_items_drops_unfilled_rows():
    """내용을 안 적은 행은 우선순위 줄만 남으므로 버린다."""
    assert parse_action_items("[ ] 긴급 [ ] 보통 [ ] 낮음") == []


def test_parse_action_items_without_checkboxes_keeps_text():
    """자유 서술로 적은 액션 아이템도 내용은 그대로 살린다."""
    items = parse_action_items("김민준이 문서를 작성한다.")

    assert items == [(None, "김민준이 문서를 작성한다.")]


def test_checked_priority_overrides_ai_guess():
    """AI가 순서로 임의 추정하던 우선순위를 사용자가 체크한 값이 대체한다."""
    sections = MeetingSections(decisions="PG사는 A사로 간다.", todos=TABLE_TODOS)

    result = analyze_meeting(_request(sections=sections))

    by_assignee = {todo.assignee_candidate: todo.priority for todo in result.todos}
    assert by_assignee["김민준"] == "HIGH", "체크한 '긴급'이 반영되어야 한다"
    assert by_assignee["이서연"] == "LOW", "체크한 '낮음'이 반영되어야 한다"


def test_priority_checkbox_lines_are_not_treated_as_todo_text():
    sections = MeetingSections(decisions="PG사는 A사로 간다.", todos=TABLE_TODOS)

    result = analyze_meeting(_request(sections=sections))

    assert not any("긴급" in todo.title for todo in result.todos)


def test_every_action_item_row_becomes_a_todo():
    """키워드에 안 걸린다고 사용자가 직접 적은 액션 아이템을 버리면 안 된다."""
    sections = MeetingSections(decisions="PG사는 A사로 간다.", todos=TABLE_TODOS)

    result = analyze_meeting(_request(sections=sections))

    assert len(result.todos) == 2
    assert {t.assignee_candidate for t in result.todos} == {"김민준", "이서연"}


def test_unchecked_action_item_defaults_to_medium():
    sections = MeetingSections(
        decisions="PG사는 A사로 간다.",
        todos="[ ] 긴급 [ ] 보통 [ ] 낮음\n김민준이 문서를 정리한다.",
    )

    result = analyze_meeting(_request(sections=sections))

    assert [t.priority for t in result.todos] == ["MEDIUM"]


def test_schema_placeholder_statements_are_dropped():
    """프롬프트 스키마의 '...' 를 모델이 따라 적으면 결정사항·위험요소에 그대로 노출된다."""
    cleaned = sanitize_model_statements(
        ["PG사는 A사로 확정한다.", "...", "…", "결정사항 문장", ""],
        source_text="PG사는 A사로 확정한다.",
        meeting_date="2026-08-02",
    )

    assert cleaned == ["PG사는 A사로 확정한다."]
