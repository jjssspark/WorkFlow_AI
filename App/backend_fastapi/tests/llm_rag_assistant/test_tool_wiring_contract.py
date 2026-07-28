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
_CASE_PATTERN = re.compile(r'^\s*case "([a-z_]+)":', re.MULTILINE)


def _executor_tools() -> set[str]:
    source = _ACTION_EXECUTOR.read_text(encoding="utf-8")
    return set(_CASE_PATTERN.findall(source))


def test_action_executor_file_is_where_we_think_it_is() -> None:
    """경로가 틀리면 아래 테스트가 빈 집합끼리 비교해 조용히 통과한다."""
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
