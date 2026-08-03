"""질문에서 업무 id 지칭을 읽어내는 규칙.

화면이 TASK-230 을 보여주므로 사용자는 그렇게 말한다. 하지만 "230번"처럼도 말한다.
맨숫자는 받지 않는다 - "3일 남은", "230명" 같은 표현이 전부 업무 지칭이 돼버린다.
"""

from __future__ import annotations

import pytest

from llm_rag_assistant.app.services.retrieval_service import (
    TASK_CODE_PATTERN,
    extract_task_codes,
    extract_task_ids,
)


@pytest.mark.parametrize(
    "question, expected",
    [
        ("TASK-230 현재 상황 알려줘", [230]),
        ("task-230 어떻게 돼가", [230]),
        ("230번 현재 상황 알려줘", [230]),
        ("230 번 상황", [230]),
        ("#230 상황", [230]),
        ("TASK-230", [230]),
    ],
)
def test_지칭_형태_세_가지를_모두_읽는다(question, expected):
    assert extract_task_ids(question) == expected


@pytest.mark.parametrize(
    "question",
    [
        "230 현재 상황",  # 맨숫자는 받지 않는다
        "3일 남은 업무 알려줘",
        "참여자 230명 규모",
        "3번째 회의 요약해줘",  # 번째는 서수지 id 가 아니다
        "업무 상황 알려줘",
        "",
    ],
)
def test_업무_지칭이_아닌_숫자는_읽지_않는다(question):
    assert extract_task_ids(question) == []


def test_같은_id를_여러_번_말해도_한_번만_센다():
    assert extract_task_ids("TASK-230 과 230번은 같은 업무야") == [230]


def test_여러_업무를_말한_순서를_지킨다():
    assert extract_task_ids("TASK-230 과 #7 과 15번") == [230, 7, 15]


def test_None_이_와도_터지지_않는다():
    assert extract_task_ids(None) == []


# --- 기존 코드 경로와의 충돌 ---
#
# TASK-230 은 TASK_CODE_PATTERN([A-Za-z]{2,}-\d+)에도 매칭된다. 걸러내지 않으면
# 본문 텍스트 검색이 함께 발동해 0건을 받고 슬롯만 먹는다.


def test_표시용_코드는_기존_코드_정규식에도_잡힌다():
    assert TASK_CODE_PATTERN.findall("TASK-230") == ["TASK-230"]


def test_표시용_코드는_본문_코드_후보에서_빠진다():
    assert extract_task_codes("TASK-230 현재 상황") == []


def test_사람이_적어_넣은_코드는_그대로_남는다():
    assert extract_task_codes("WF-195 와 FS-4 상황") == ["WF-195", "FS-4"]


def test_표시용_코드와_본문_코드가_섞이면_각자의_경로로_갈린다():
    question = "TASK-230 과 WF-195 비교해줘"
    assert extract_task_ids(question) == [230]
    assert extract_task_codes(question) == ["WF-195"]
