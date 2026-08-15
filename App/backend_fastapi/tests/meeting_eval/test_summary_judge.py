from __future__ import annotations

from meeting_eval.summary_judge import judge_summary


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


def test_prompt_carries_summary_decisions_and_item():
    seen = []

    def fake_ask(prompt):
        seen.append(prompt)
        return "예"

    judge_summary("요약본", ["결정A"], ["항목1"], ask=fake_ask)

    assert "요약본" in seen[0]
    assert "결정A" in seen[0]
    assert "항목1" in seen[0]


def test_empty_checklist_scores_zero():
    score = judge_summary("요약", [], [], ask=lambda prompt: "예")

    assert score.score == 0.0
    assert score.verdicts == []
