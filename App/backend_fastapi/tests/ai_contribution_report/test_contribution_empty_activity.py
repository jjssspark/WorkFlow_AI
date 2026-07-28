"""UT-200: 활동 기록이 없는 멤버도 리포트에서 빠지지 않는다.

기존 테스트는 "멤버가 아예 없으면 빈 목록"(returns_empty_list_when_no_members)까지만 본다.
실제로 문제가 되는 쪽은 그 반대다 - 멤버는 있는데 업무도 회의도 0건인 경우, 집계에서 조용히
빠지면 심사자 화면에서 그 사람만 사라진다. 평가 대상에서 누락되는 것이라 "0점"보다 나쁘다.

집계 SQL은 project_members에서 시작해 tasks/meetings를 LEFT JOIN하므로 활동이 없어도 행은
남는다. 여기서 보는 것은 그 뒤의 파이썬 경로 - 0건짜리 행이 근거 문장과 리포트까지
살아서 도달하는가다.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from ai_contribution_report.app.services import contribution_service as service
from ai_contribution_report.app.services.contribution_service import build_evidence


def _idle_member_row() -> dict:
    return {
        "user_id": 15, "name": "활동없는팀원",
        "todo_done": 0, "todo_total": 0,
        "meetings_attended": 0, "meetings_total": 0,
    }


def test_evidence_states_zero_activity_instead_of_omitting_it():
    """근거 문장이 비어버리면 LLM이 채울 근거가 없어 추측 요약이 나온다."""
    evidence = build_evidence(_idle_member_row())

    assert evidence[0] == "To-Do 0/0건 완료"
    assert "등록된 회의 없음" in evidence


@pytest.mark.asyncio
async def test_member_with_no_activity_still_gets_a_report_row():
    rows = [_idle_member_row(), {
        "user_id": 16, "name": "활동있는팀원",
        "todo_done": 3, "todo_total": 5,
        "meetings_attended": 2, "meetings_total": 4,
    }]
    saved: list[list[dict]] = []

    with patch.object(service.db, "load_contribution_inputs", return_value=rows), \
         patch.object(service.db, "load_workload_scores", return_value={}), \
         patch.object(service.db, "save_contribution_reports",
                      side_effect=lambda project_id, reports: saved.append(reports)), \
         patch.object(service, "generate_summary", return_value="요약"):
        results = await service.generate_contribution_reports(project_id=1)

    # 활동이 있는 사람만 남기는 구현으로 바뀌면 여기서 잡힌다.
    assert [r.user_id for r in results] == [15, 16]
    assert [r["user_id"] for r in saved[0]] == [15, 16]
    assert results[0].evidence[0] == "To-Do 0/0건 완료"
