from __future__ import annotations

import re

# 분류는 2단계다. 여기(1단계)는 LLM 없이 도는 규칙 선별로, 명령형 신호가 없는 발화를
# 즉시 질문으로 확정해 기존 질문 응답에 추가 지연이 붙지 않게 한다.
#
# 오분류 방향이 비대칭이라 규칙을 보수적으로 잡는다.
#   명령을 질문으로 오분류 → 실행되지 않고 설명만 나옴 (사용자가 다시 말하면 됨)
#   질문을 명령으로 오분류 → 엉뚱한 확인 카드가 뜸 (훨씬 나쁨)
# 따라서 "동사 어간 + 요청 어미"가 모두 있을 때만 명령 후보로 본다.

# "알려줘/보여줘"는 요청 어미를 갖지만 조회다. 동사 어간만 보면 "삭제된 업무 알려줘"가
# 명령으로 잡히므로, 조회 요청은 어간 검사보다 먼저 걸러낸다.
_QUERY_REQUEST_PATTERN = re.compile(r"(알려|보여|말해|설명해|찾아|가르쳐)\s*(줘|주세요|줄래|다오)")

# 어간 뒤에 된/될/됐/했이 오면 동작 요청이 아니라 명사를 꾸미는 관형형이다.
# ("완료된 업무 목록 줘"는 조회지 명령이 아니다.) "추가로"는 부사라 같이 제외한다.
# 조사 '로'는 "완료로 바꿔줘"처럼 명령에도 붙으므로 '추가'에만 적용한다.
_ACTION_STEM_PATTERN = re.compile(
    r"(?:추가(?!된|될|됐|했|로)|"
    r"(?:바꿔|바꾸|변경|옮겨|옮기|이동|되돌려|되돌리|"
    r"지정|설정|잡아|"
    r"남겨|남기|달아|작성|"
    r"체크|완료|"
    r"삭제|지워|지우|"
    r"등록|생성|만들어|"
    r"수정|고쳐|고치|"
    r"배정|할당)(?!된|될|됐|했))"
)

_IMPERATIVE_ENDING_PATTERN = re.compile(r"(줘|주세요|줄래|해라|하자|할래|해봐|바꿔|부탁)")


def is_command_candidate(question: str) -> bool:
    """LLM 분류를 호출할 가치가 있는 발화인지 판정한다.

    True여도 명령이 확정된 것은 아니다. 계획 노드가 최종 판단한다.
    """
    text = question.strip()
    if not text:
        return False
    if _QUERY_REQUEST_PATTERN.search(text):
        return False
    return bool(_ACTION_STEM_PATTERN.search(text) and _IMPERATIVE_ENDING_PATTERN.search(text))
