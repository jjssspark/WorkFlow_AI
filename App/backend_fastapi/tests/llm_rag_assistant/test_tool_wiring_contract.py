"""그래프가 만들 수 있는 도구와 프론트가 실행할 수 있는 도구가 같은지 본다.

이 둘이 어긋나도 지금은 **어느 테스트도 실패하지 않는다.**

  SUPPORTED_TOOLS에 있는데 실행기에 없음
      확인 카드는 정상적으로 뜬다. 사용자가 누르면 default 분기로 떨어져
      "아직 지원하지 않는 작업입니다."가 나온다. 파이썬 테스트는 카드가 나오므로 통과하고,
      프론트 테스트는 그 도구를 모르므로 아예 검사하지 않는다.

  실행기에 있는데 SUPPORTED_TOOLS에 없음
      prepare 단계에서 차단돼 카드 자체가 안 나온다. 실행기 코드는 영원히 죽은 코드다.

앞의 경우가 실제로 위험하다. 확인 카드까지 정상으로 보이므로 QA에서도 "승인 눌렀는데
아무 일도 안 일어남"으로만 관측된다. 도구를 새로 붙일 때 가장 밟기 쉬운 실수라서
(권한 축과 실행 축이 별개다) 여기서 두 목록을 직접 대조한다.

state.py 상수를 TS로 복제해 못 박는 방법도 있지만, 그건 양쪽을 같이 고쳐야 한다는 사실만
알려줄 뿐 실제로 어긋났는지는 못 본다. 여기서는 실행기 소스를 읽어 직접 비교한다.
크로스 레포 경로 참조는 conftest.py가 db/init을 읽는 것과 같은 방식이다.
"""

from __future__ import annotations

import re
from pathlib import Path

from llm_rag_assistant.app.graph.state import SUPPORTED_TOOLS

# tests/llm_rag_assistant/ -> tests/ -> backend_fastapi/ -> App/
_ACTION_EXECUTOR = (
    Path(__file__).resolve().parents[3] / "frontend" / "src" / "ai" / "libs" / "utils" / "actionExecutor.ts"
)

# switch (card.tool)의 case 라벨. default는 잡히지 않는다.
#
# 소스를 정규식으로 읽는 이상 실행기 문법이 바뀌면 이 패턴이 따라가지 못한다. 그래서
# 중요한 성질은 "정확히 읽는다"가 아니라 **fail-closed**다 - 못 읽으면 통과가 아니라
# 실패해야 한다. 아래 _extract_tools 단위 테스트가 그 성질을 직접 확인한다.
#
#   따옴표 종류가 바뀜        -> 그 도구만 누락 -> "실행기가 처리 못함"으로 실패(안전)
#   switch를 맵으로 리팩터링   -> 하나도 못 찾음 -> 구조 변경 감지 테스트가 실패(안전)
#
# 어느 경우든 조용히 통과하지 않으므로, 최악은 정상 리팩터링 시 한 번 시끄러운 것이다.
_CASE_PATTERN = re.compile(r"""case\s*['"]([a-z_]+)['"]\s*:""")


def _extract_tools(source: str) -> set[str]:
    return set(_CASE_PATTERN.findall(source))


def _executor_tools() -> set[str]:
    return _extract_tools(_ACTION_EXECUTOR.read_text(encoding="utf-8"))


def test_extractor_reads_the_case_shapes_typescript_actually_allows() -> None:
    """추출기 자체를 검증한다. 이게 조용히 덜 읽으면 대조가 무의미해진다.

    실행기 파일로만 검사하면 지금 그 파일이 우연히 만족하는 형태만 통과할 뿐,
    포매터가 따옴표를 바꾸거나 case를 한 줄에 모으면 어떻게 되는지 알 수 없다.
    """
    source = """
      switch (card.tool) {
        case "change_status": {
          return a();
        }
        case 'add_comment': {
          return b();
        }
        case "delete_task": case "archive_task": {
          return c();
        }
        default:
          return d();
      }
    """
    assert _extract_tools(source) == {
        "change_status",
        "add_comment",
        "delete_task",
        "archive_task",
    }


def test_extractor_finds_nothing_when_the_switch_is_gone() -> None:
    """구조가 바뀌면 빈 집합이 된다. 그때 조용히 통과하면 안 되므로 아래 테스트가 막는다."""
    refactored = """
      const HANDLERS = { change_status: a, add_comment: b };
      return HANDLERS[card.tool]?.(card) ?? unsupported();
    """
    assert _extract_tools(refactored) == set()


def test_action_executor_file_is_where_we_think_it_is() -> None:
    """경로가 틀리거나 구조가 바뀌면 아래 테스트가 빈 집합끼리 비교해 조용히 통과한다.

    이 테스트가 그 fail-closed 성질을 담당한다. 실행기를 못 읽는 상황은 '문제 없음'이
    아니라 '확인 불가'이고, 확인 불가는 실패로 취급한다.
    """
    assert _ACTION_EXECUTOR.is_file(), f"실행기를 찾지 못했습니다: {_ACTION_EXECUTOR}"
    assert _executor_tools(), "case 라벨을 하나도 못 찾았습니다 - switch 구조가 바뀌었습니다."


def test_graph_and_executor_support_exactly_the_same_tools() -> None:
    executor_tools = _executor_tools()

    missing_in_executor = SUPPORTED_TOOLS - executor_tools
    assert not missing_in_executor, (
        f"그래프는 카드를 만들지만 실행기가 처리하지 못하는 도구: {sorted(missing_in_executor)}. "
        "확인 카드는 정상으로 보이고 누르면 '아직 지원하지 않는 작업입니다'가 나옵니다. "
        "actionExecutor.ts의 switch에 case를 추가하세요."
    )

    missing_in_graph = executor_tools - SUPPORTED_TOOLS
    assert not missing_in_graph, (
        f"실행기에만 있고 그래프가 카드를 만들지 않는 도구: {sorted(missing_in_graph)}. "
        "prepare 단계에서 차단되므로 이 코드는 실행되지 않습니다. "
        "state.py의 SUPPORTED_TOOLS에 추가하거나 실행기에서 제거하세요."
    )
