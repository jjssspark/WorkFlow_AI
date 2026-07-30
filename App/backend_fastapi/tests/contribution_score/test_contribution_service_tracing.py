from __future__ import annotations

import os

import pytest

from contribution_score.app.services.contribution_service import compute_contribution_scores
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult

# LANGSMITH_* 환경변수를 건드리는 테스트가 있으므로, tests/test_tracing.py와 동일한 패턴으로
# 각 테스트 전후 관련 환경변수를 정리해 테스트 간 순서 의존적 실패를 막는다.
_LANGSMITH_ENV_VARS = ("LANGSMITH_API_KEY", "LANGSMITH_TRACING", "LANGSMITH_PROJECT")


@pytest.fixture(autouse=True)
def _clean_langsmith_env():
    for var in _LANGSMITH_ENV_VARS:
        os.environ.pop(var, None)
    yield
    for var in _LANGSMITH_ENV_VARS:
        os.environ.pop(var, None)


def _member(assignee_id="1", completion_rate=0.5, overload_score=0.0, anomaly_types=None):
    types = anomaly_types if anomaly_types is not None else []
    return WorkloadMemberResult(
        assignee_id=assignee_id,
        task_count_total=10,
        completion_rate=completion_rate,
        overload_score=overload_score,
        is_anomaly=len(types) > 0,
        anomaly_types=types,
        difficulty_score=10.0,
        workload_score=10.0,
        allocation_score=10.0,
        task_count_active_rel=1.2,
        task_count_total_rel=1.2,
        difficulty_total_rel=1.1,
        overdue_count=1,
    )


def test_contribution_service_module_imports_chain_from_langchain_core():
    """이 모듈이 실제로 langchain_core.runnables.chain을 사용하고 있는지 정적으로 확인한다."""
    import contribution_score.app.services.contribution_service as svc

    assert hasattr(svc, "chain")


def test_compute_contribution_scores_still_returns_correct_values_through_chain_wrapper():
    """LangChain @chain 래퍼로 감싼 뒤에도 계산 결과가 기존과 동일해야 한다."""
    members = [_member(assignee_id="9", completion_rate=0.8, overload_score=0.0, anomaly_types=[])]

    results = compute_contribution_scores(members, attendance={}, total_meetings=4)

    assert len(results) == 1
    assert results[0].assignee_id == "9"
    assert results[0].workload_component == 100.0
    assert results[0].task_component == 80.0
    assert results[0].meeting_component == 0.0


def test_compute_contribution_scores_works_without_langsmith_api_key(monkeypatch):
    """LANGSMITH_API_KEY가 없어도 트레이싱은 조용히 비활성화될 뿐 계산 자체는
    정상 동작해야 한다."""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)

    members = [_member(assignee_id="1")]
    results = compute_contribution_scores(members, attendance={"1": 2}, total_meetings=4)

    assert len(results) == 1
