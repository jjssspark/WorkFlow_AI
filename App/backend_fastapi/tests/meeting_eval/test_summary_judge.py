from __future__ import annotations

from meeting_eval.summary_judge import COVERAGE, SAFETY, ChecklistItem, judge_summary


def _vacuous_checklist():
    return [
        ChecklistItem("임베딩 모델 교체 결정이 요약에 담겼는가", COVERAGE),
        ChecklistItem("요약에 적힌 날짜가 모두 회의록 원문에 나오는가", SAFETY),
    ]


def test_vacuous_summary_scores_zero():
    """아무 말도 안 한 요약은 안전성 문항을 거저 통과한다.

    두 축을 평균하던 시절에는 그것만으로 바닥값이 0.5였고, 날짜와 이름을 아예 쓰지 않는
    규칙 기반 요약이 측정에서 1위(0.792)를 했다. 지어내지 않은 것은 담아낸 것이 아니다.
    """
    score = judge_summary(
        "회의를 진행했습니다.",
        [],
        _vacuous_checklist(),
        ask=lambda prompt: "아니오" if "담겼는가" in prompt else "예",
    )

    assert score.coverage == 0.0
    assert score.safety == 1.0
    assert score.score == 0.0


def test_hallucinated_summary_forfeits_its_coverage():
    """담아낸 내용이 아무리 많아도 지어낸 요약은 쓸 수 없다."""
    score = judge_summary(
        "임베딩 모델을 교체하기로 했다. 8월 30일까지 끝낸다.",
        [],
        _vacuous_checklist(),
        ask=lambda prompt: "예" if "담겼는가" in prompt else "아니오",
    )

    assert score.coverage == 1.0
    assert score.safety == 0.0
    assert score.score == 0.0


def test_safety_defaults_to_one_when_no_safety_item_is_declared():
    """안전성 문항이 없다는 것은 '어길 제약이 없다'는 뜻이라 충실도가 그대로 점수가 된다.

    충실도 쪽은 반대로 0.0이 기본값이다. 잰 것이 없으면 점수를 줄 근거도 없다.
    """
    score = judge_summary(
        "요약", [], [ChecklistItem("항목1", COVERAGE)], ask=lambda prompt: "예"
    )

    assert score.safety == 1.0
    assert score.score == 1.0


def test_all_pass_scores_one():
    score = judge_summary("임베딩 모델을 교체하기로 했다.", ["임베딩 모델 교체"],
                          ["교체 결정이 담겼는가", "없는 날짜가 없는가"],
                          ask=lambda prompt: "예")

    assert score.score == 1.0
    assert [v.passed for v in score.verdicts] == [True, True]


def test_partial_pass_scores_half():
    answers = iter(["예", "아니오"])
    score = judge_summary("요약", [], ["항목1", "항목2"], ask=lambda prompt: next(answers))

    assert score.score == 0.5


def test_unparseable_answer_counts_as_fail():
    score = judge_summary("요약", [], ["항목1"], ask=lambda prompt: "글쎄요 판단하기 어렵습니다")

    assert score.score == 0.0


def test_coverage_is_judged_on_the_summary_alone():
    """충실도 문항에는 결정사항을 넘기지 않는다.

    양식 문서의 결정사항 칸은 규칙 기반이 그대로 복사하기 때문에 항상 채워져 있다.
    같이 넘기면 "회의 내용을 분석해 결정사항 1건, 업무 후보 2건을 추출했습니다" 같은
    빈 요약도 결정사항 블록을 근거로 통과한다. 실제로 nosep-02 에서 세 티어 모두
    그렇게 통과했다. 문항 문면이 "요약에 담겼는가"이므로 요약문만 보고 판정한다.
    """
    seen = []

    def fake_ask(prompt):
        seen.append(prompt)
        return "예"

    judge_summary(
        "요약본",
        ["결정A"],
        [ChecklistItem("항목1", COVERAGE)],
        ask=fake_ask,
        source_text="원문에만 있는 사실",
    )

    assert "요약본" in seen[0]
    assert "항목1" in seen[0]
    assert "결정A" not in seen[0]
    # 원문도 넘기면 안 된다. 결정사항만 뺐을 때 규칙 기반 many-01 이 0.29 -> 0.86 으로
    # 뛰었는데 요약은 그대로 기계 문구였다. 심사기가 요약 대신 원문을 읽고 답한 것이다.
    assert "원문에만 있는 사실" not in seen[0]


def test_safety_still_sees_the_decisions():
    """안전성은 지어내지 않았는가를 묻는다. 결정사항에 지어낸 날짜가 섞이면
    그것도 사용자에게 나가므로 심사 대상에서 빼면 안 된다."""
    seen = []

    def fake_ask(prompt):
        seen.append(prompt)
        return "예"

    judge_summary("요약본", ["결정A"], [ChecklistItem("항목1", SAFETY)], ask=fake_ask)

    assert "결정A" in seen[0]


def test_prompt_carries_source_text_when_given():
    """체크리스트 항목의 절반은 '원문에 없는 날짜나 이름이 요약에 없는가' 형태다.

    심사기에게 원문을 주지 않으면 이 질문은 원리상 답할 수 없다. 실제로 1.5B와 4B
    두 모델 모두 정확히 이 문항에서만 반복해서 틀렸고, 원문 부재가 그 원인이었다.
    """
    seen = []

    def fake_ask(prompt):
        seen.append(prompt)
        return "예"

    judge_summary(
        "요약본",
        ["결정A"],
        [ChecklistItem("항목1", SAFETY)],
        ask=fake_ask,
        source_text="박지수: 8월 10일까지 끝냅니다.",
    )

    assert "박지수: 8월 10일까지 끝냅니다." in seen[0]


def test_prompt_omits_source_section_when_not_given():
    seen = []

    def fake_ask(prompt):
        seen.append(prompt)
        return "예"

    judge_summary("요약본", ["결정A"], ["항목1"], ask=fake_ask)

    assert "[회의록 원문]" not in seen[0]


def test_empty_checklist_scores_zero():
    score = judge_summary("요약", [], [], ask=lambda prompt: "예")

    assert score.score == 0.0
    assert score.verdicts == []
