from __future__ import annotations

import pytest

from llm_rag_assistant.app.services.command_classifier import is_command_candidate


@pytest.mark.parametrize(
    "question",
    [
        "내 업무가 뭐야?",
        "마감 임박한 업무 있어?",
        "그 업무는 언제까지야?",
        "로그인 API 진행 상황 어때?",
        "",
        "   ",
    ],
)
def test_plain_questions_are_not_command_candidates(question: str) -> None:
    """질문에 LLM 분류 호출이 붙으면 기존 응답이 통째로 느려진다."""
    assert is_command_candidate(question) is False


@pytest.mark.parametrize(
    "question",
    [
        "WF-250 완료로 바꿔줘",
        "WF-250 상태 변경해줘",
        "로그인 업무에 코멘트 남겨줘",
        "체크리스트 첫 번째 항목 체크해줘",
        "WF-246 마감일 8월 10일로 지정해주세요",
        "그 업무 삭제해줘",
        "WF-174 할 일로 되돌려줘",
        "WF-189 진행중으로 되돌려주세요",
    ],
)
def test_imperative_requests_are_command_candidates(question: str) -> None:
    assert is_command_candidate(question) is True


@pytest.mark.parametrize(
    "question",
    [
        "삭제된 업무 목록 알려줘",
        "마감일 지정된 업무 보여줘",
        "담당자 배정 규칙 설명해줘",
        "완료 처리 방법 가르쳐줘",
    ],
)
def test_query_requests_are_not_command_candidates(question: str) -> None:
    """'알려줘/보여줘'는 요청 어미지만 조회다. 동사 어간만 보면 오분류된다."""
    assert is_command_candidate(question) is False


# 관형형("완료된 업무")은 상태를 서술할 뿐 동작 요청이 아니다. 어간만 보고 명령으로
# 세면 평범한 조회 질문이 명령 경로로 새어 나간다.
@pytest.mark.parametrize(
    "question",
    [
        "완료된 업무 목록 좀 줘",
        "이번 주 추가된 업무 정리해줘",
        "변경된 내용 요약해줘",
        "추가로 확인할 사항 정리 부탁",
        "삭제된 업무 있으면 알려줘",
        "수정된 부분 짚어줘",
    ],
)
def test_adnominal_forms_are_not_commands(question: str) -> None:
    assert is_command_candidate(question) is False


@pytest.mark.parametrize(
    "question",
    ["결제 API 업무 완료로 바꿔줘", "완료로 처리해줘", "이 업무 추가해줘"],
)
def test_real_commands_survive_the_adnominal_filter(question: str) -> None:
    assert is_command_candidate(question) is True
