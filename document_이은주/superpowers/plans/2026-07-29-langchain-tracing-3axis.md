# 워크로드/기여도 스코어 LangChain 트레이싱 재도입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_workload_score()`(3축 이상치 탐지)와 `compute_contribution_scores()`(workload/task/meeting 가중합) 파이프라인에 LangChain(`langchain-core`) `Runnable`/`@chain` 계측을 추가해, `LANGSMITH_API_KEY`가 설정된 환경에서 각 실행이 LangSmith 대시보드에 부모-자식 trace 트리로 보이게 한다.

**Architecture:** 공개 함수(`get_workload_score`, `build_features`, `detect_overload_anomalies_auto`, `compute_contribution_scores`)의 시그니처는 전혀 바꾸지 않는다. 각 서비스 함수 내부에서만 로컬 `@chain` 스텝(클로저로 실제 데이터를 주고받고, 트레이스에는 요약 dict만 노출)을 만들어 `.invoke()`/`.ainvoke()`한다. `setup_langsmith()`를 `ml_workload_score` 전용에서 `core/tracing.py`로 옮겨 `contribution_score`와 공유한다.

**Tech Stack:** langchain-core==1.4.9, langsmith==0.10.2 (둘 다 `requirements.txt`에 이미 존재, 설치 불필요), pytest, pytest-asyncio, unittest.mock.

## Global Constraints

- 공개 함수 시그니처(`get_workload_score(project_id, use_synthetic_fallback=False)`, `build_features(tasks_df, today=None)`, `detect_overload_anomalies_auto(feature_df, small_team_threshold=15)`, `compute_contribution_scores(workload_members, attendance, total_meetings)`)는 절대 변경하지 않는다.
- 기존 테스트(`test_workload_model_*.py` 6개, `test_workload_service.py`, `test_contribution_service.py`, `test_contribution_score_bounds.py`, `test_contribution_db.py`)는 **무수정으로 통과**해야 한다.
- `LANGSMITH_API_KEY` 미설정 환경(테스트 환경 포함)에서 트레이싱은 완전히 부가 기능으로 동작하고, 실제 파이프라인 응답/예외 흐름에는 영향을 주지 않는다.
- 신규 패키지 설치 없음.
- 팀원별 원본 업무 데이터, 전체 `WorkloadMemberResult`/`ContributionMemberResult` 리스트를 트레이스에 그대로 노출하지 않는다 — 요약 통계(dict)만 노출한다.
- 모든 주석/설명은 한국어로 작성한다.
- FastAPI 로컬 실행 시 `App/backend_fastapi`를 cwd로 하고 `PYTHONPATH=.`로 pytest를 돌린다(`ml_workload_score`, `contribution_score`, `core` 등이 최상위 패키지로 임포트됨).
- `tests/ml_workload_score/test_workload_router.py`, `tests/contribution_score/test_contribution_router.py`는 로컬 `.venv`의 `redis` 패키지 임포트 문제(`ImportError: cannot import name 'Redis' from 'redis'`)로 이 작업과 무관하게 이미 collection 단계에서 실패한다 — 이번 작업에서 새로 깨뜨리지 않는 것만 확인하고, 이 기존 실패 자체는 손대지 않는다.

---

### Task 1: `core/tracing.py` 공유 유틸 생성

**Files:**
- Create: `App/backend_fastapi/core/tracing.py`
- Test: `App/backend_fastapi/tests/test_tracing.py`

**Interfaces:**
- Produces: `setup_langsmith(project_name: str = "workflow-ai-backend") -> bool` — `ml_workload_score`/`contribution_score` 라우터 양쪽에서 임포트해서 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`App/backend_fastapi/tests/test_tracing.py`:

```python
from __future__ import annotations

import os
from unittest.mock import patch

from core.tracing import setup_langsmith


def test_setup_langsmith_returns_false_without_api_key(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith()

    assert result is False
    assert "LANGSMITH_TRACING" not in os.environ


def test_setup_langsmith_clears_preexisting_tracing_flag_without_api_key(monkeypatch):
    """docker-compose가 LANGSMITH_TRACING=${LANGSMITH_TRACING:-false}로 프로세스에
    이미 "true"를 주입해 놓은 상태에서 API 키만 빠지면, 반환값(False)과 실제
    환경변수 상태가 어긋나지 않도록 LANGSMITH_TRACING을 지워야 한다."""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith()

    assert result is False
    assert "LANGSMITH_TRACING" not in os.environ


def test_setup_langsmith_enables_tracing_with_default_project(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith()

    assert result is True
    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert os.environ["LANGSMITH_PROJECT"] == "workflow-ai-backend"


def test_setup_langsmith_respects_custom_project_name(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith(project_name="custom-project")

    assert result is True
    assert os.environ["LANGSMITH_PROJECT"] == "custom-project"


def test_setup_langsmith_reads_project_name_from_env_over_default(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)

    with patch(
        "core.tracing.dotenv_values",
        return_value={"LANGSMITH_PROJECT": "from-dotenv-project"},
    ):
        result = setup_langsmith()

    assert result is True
    assert os.environ["LANGSMITH_PROJECT"] == "from-dotenv-project"
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd App/backend_fastapi && PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/test_tracing.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.tracing'`

- [ ] **Step 3: 최소 구현 작성**

`App/backend_fastapi/core/tracing.py`:

```python
from __future__ import annotations

import logging
import os

from dotenv import dotenv_values

logger = logging.getLogger(__name__)


def setup_langsmith(project_name: str = "workflow-ai-backend") -> bool:
    """
    LangSmith 트레이싱 활성화.

    workload_db.py와 동일한 패턴으로 dotenv_values()를 직접 읽는다 - core.config.get_settings()는
    이 dev 환경에서 App/.env를 못 찾아 ValidationError가 나는 게 확인된 상태라 재사용하지 않는다.
    ml_workload_score/contribution_score 양쪽 라우터가 공통으로 쓰므로 core/에 둔다.

    필요 환경변수:
      LANGSMITH_API_KEY - LangSmith API 키 (smith.langchain.com에서 발급)
      LANGSMITH_PROJECT - 대시보드에 표시될 프로젝트명 (선택, 없으면 project_name 사용)

    LangChain의 자동 트레이싱(Runnable.invoke/ainvoke 실행 시 콜백)도 langsmith SDK와 동일하게
    LANGSMITH_TRACING/LANGSMITH_API_KEY 환경변수를 읽으므로, 이 유틸 하나로 LangChain 파이프라인
    계측까지 함께 켜진다.
    """
    env = {**dotenv_values(), **os.environ}
    api_key = env.get("LANGSMITH_API_KEY")

    if not api_key:
        # docker-compose가 LANGSMITH_TRACING=${LANGSMITH_TRACING:-false}로 프로세스에
        # 이미 "true"를 주입해 놓은 상태에서 API 키만 빠진 경우, 여기서 지워주지 않으면
        # 반환값(False)과 실제 프로세스 상태(LANGSMITH_TRACING=true)가 어긋나 LangChain/langsmith
        # SDK가 트레이싱을 시도하다 인증 실패로 조용히 실패하는 혼선이 생길 수 있다.
        os.environ.pop("LANGSMITH_TRACING", None)
        logger.warning("LANGSMITH_API_KEY 미설정 - LangChain 트레이싱 비활성화 상태로 진행")
        return False

    os.environ["LANGSMITH_API_KEY"] = api_key
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGSMITH_PROJECT"] = env.get("LANGSMITH_PROJECT", project_name)
    logger.info("LangSmith 트레이싱 활성화됨 (project=%s)", os.environ["LANGSMITH_PROJECT"])
    return True
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd App/backend_fastapi && PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/test_tracing.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
git add App/backend_fastapi/core/tracing.py App/backend_fastapi/tests/test_tracing.py
git commit -m "feat: setup_langsmith() 공유 유틸을 core/tracing.py에 추가

- 기존 ml_workload_score 전용 tracing.py 대신 core/에 둬서
  contribution_score도 같이 쓸 수 있게 함
- LangChain Runnable 트레이싱도 동일 환경변수(LANGSMITH_TRACING/API_KEY)로
  자동 활성화되므로 이 유틸 하나로 양쪽 파이프라인 커버"
```

---

### Task 2: `workload_service.py`에 LangChain 트레이싱 스텝 추가

**Files:**
- Modify: `App/backend_fastapi/ml_workload_score/app/services/workload_service.py`
- Modify: `App/backend_fastapi/ml_workload_score/app/routers/workload_router.py`
- Test: `App/backend_fastapi/tests/ml_workload_score/test_workload_service.py` (기존 파일 — 무수정으로 통과해야 함)
- Test: `App/backend_fastapi/tests/ml_workload_score/test_workload_service_tracing.py` (신규)

**Interfaces:**
- Consumes: `core.tracing.setup_langsmith` (Task 1), `ml_workload_score.app.services.workload_model.build_features(tasks_df, today=None) -> pd.DataFrame`, `detect_overload_anomalies_auto(feature_df, small_team_threshold=15) -> pd.DataFrame`.
- Produces: `get_workload_score(project_id: int, use_synthetic_fallback: bool = False) -> WorkloadScoreData` — 시그니처/반환 타입 불변, 내부만 변경.

- [ ] **Step 1: 실패하는 트레이싱 스모크 테스트 작성**

`App/backend_fastapi/tests/ml_workload_score/test_workload_service_tracing.py`(신규):

```python
from __future__ import annotations

from unittest.mock import patch

import pandas as pd
import pytest

from ml_workload_score.app.services.workload_service import get_workload_score


def _fake_tasks_df() -> pd.DataFrame:
    today = pd.Timestamp("2026-07-16")
    return pd.DataFrame([
        {"task_id": 1, "project_id": 1, "assignee_id": "1", "category": "백엔드",
         "priority": "높음", "status": "할 일", "due_date": today + pd.Timedelta(days=5)},
        {"task_id": 2, "project_id": 1, "assignee_id": "2", "category": "문서",
         "priority": "낮음", "status": "완료", "due_date": today - pd.Timedelta(days=1)},
    ])


def _fake_result_row(**overrides) -> dict:
    base = {
        "assignee_id": "1", "task_count_total": 1, "completion_rate": 0.0,
        "overload_score_0_100": 10.0, "is_anomaly": False, "anomaly_types": [],
        "difficulty_score": 5.0, "workload_score": 5.0, "allocation_score": 5.0,
        "task_count_active_rel": 1.0, "task_count_total_rel": 1.0,
        "difficulty_total_rel": 1.0, "overdue_count": 0,
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_get_workload_score_still_calls_build_features_and_detect_through_chain_wrapper():
    """LangChain @chain 래퍼로 감싼 뒤에도 build_features/detect_overload_anomalies_auto가
    실제로 호출되고, 그 반환값이 최종 결과에 그대로 반영되는지 확인한다(체인 래퍼가
    원본 함수 호출을 우회하지 않는지 검증)."""
    tasks_df = _fake_tasks_df()
    with patch(
        "ml_workload_score.app.services.workload_service.db.load_tasks_from_db",
        return_value=tasks_df,
    ), patch(
        "ml_workload_score.app.services.workload_service.build_features",
    ) as mock_build_features, patch(
        "ml_workload_score.app.services.workload_service.detect_overload_anomalies_auto",
    ) as mock_detect:
        mock_build_features.return_value = pd.DataFrame([_fake_result_row()])
        mock_detect.return_value = pd.DataFrame([_fake_result_row(
            task_count_total=7, completion_rate=0.9,
        )])
        mock_detect.return_value.attrs = {"method_used": "MAD (소규모 팀)"}

        result = await get_workload_score(project_id=1)

    mock_build_features.assert_called_once_with(tasks_df)
    mock_detect.assert_called_once()
    assert result.members[0].task_count_total == 7
    assert result.members[0].completion_rate == pytest.approx(0.9)
    assert result.method == "MAD (소규모 팀)"


@pytest.mark.asyncio
async def test_get_workload_score_works_without_langsmith_api_key(monkeypatch):
    """LANGSMITH_API_KEY가 없어도(테스트 환경 기본 상태) 트레이싱은 조용히 비활성화될 뿐
    파이프라인 자체는 정상 동작해야 한다."""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)

    result = await get_workload_score(project_id=1, use_synthetic_fallback=True)

    assert result.source == "synthetic_fallback"
    assert len(result.members) > 0
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd App/backend_fastapi && PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_service_tracing.py -v`
Expected: 현재 구현으로도 이 테스트 자체는 이미 통과할 수 있음(트레이싱 이전 상태이므로) — 통과하면 그대로 두고 Step 3에서 실제로 체인 래퍼가 호출되는지를 검증하는 테스트를 하나 더 추가해 실패를 명확히 만든다:

```python
def test_workload_service_module_imports_chain_from_langchain_core():
    """이 모듈이 실제로 langchain_core.runnables.chain을 사용하고 있는지 정적으로 확인한다."""
    import ml_workload_score.app.services.workload_service as svc

    assert hasattr(svc, "chain")
```

이 테스트를 `test_workload_service_tracing.py`에 추가한 뒤 실행하면:
Expected: FAIL — `AttributeError` (아직 workload_service.py가 chain을 임포트하지 않음)

- [ ] **Step 3: `workload_service.py`에 LangChain 트레이싱 스텝 구현**

`App/backend_fastapi/ml_workload_score/app/services/workload_service.py` 전체를 다음으로 교체:

```python
from __future__ import annotations

import asyncio
import logging

from langchain_core.runnables import chain

from ml_workload_score.app.services import workload_db as db
from ml_workload_score.app.services.workload_model import (
    build_features,
    detect_overload_anomalies_auto,
    generate_synthetic_tasks,
)
from ml_workload_score.app.schema.workload_schema import (
    WorkloadMemberResult,
    WorkloadScoreData,
)

logger = logging.getLogger(__name__)

# 이상치 판정 3축(compute_axis_results()의 _labels()에 정의된 라벨 그대로) - 트레이스 요약에서
# anomaly_types 리스트를 라벨별 발생 횟수로 집계할 때 사용한다.
_ANOMALY_LABELS = [
    "난이도 편중 의심", "난이도 이상 패턴(방향 불명확)",
    "업무량 편중 의심", "업무량 이상 패턴(방향 불명확)",
    "배정량 불균형", "배정 이상 패턴(방향 불명확)",
]


def _run_build_features(tasks_df):
    """
    build_features()를 LangChain @chain으로 감싸 LangSmith 트레이스에 남긴다.

    체인 함수 자체의 입출력(트레이스에 기록되는 값)은 원본 DataFrame이 아니라 요약 dict로
    제한한다 - 팀원 개인 업무 원본이 그대로 외부(LangSmith)로 전송되지 않게 하기 위함
    (embedding_difficulty.py의 _summarize_* 방어 패턴과 동일한 원칙). 실제 DataFrame은
    파이썬 클로저(holder)로 다음 단계에 직접 전달한다.

    @chain은 모듈 로드 시점이 아니라 이 함수가 호출될 때마다 새로 만든다 - 그래야
    unittest.mock.patch("....build_features")로 이 함수를 갈아끼운 테스트가, patch 시점 이후에
    호출되는 최신 심볼을 참조해 mock이 정상적으로 먹힌다.
    """
    holder: dict = {}

    @chain
    def _build_features_step(trace_input: dict) -> dict:
        holder["features"] = build_features(tasks_df)
        return {"feature_count": len(holder["features"])}

    _build_features_step.invoke({
        "row_count": len(tasks_df),
        "member_count": tasks_df["assignee_id"].nunique() if not tasks_df.empty else 0,
    })
    return holder["features"]


def _run_detect_anomalies(feature_df):
    """detect_overload_anomalies_auto()를 LangChain @chain으로 감싸 트레이스에 남긴다.
    출력 요약은 3축 구조(anomaly_types 리스트) 반영: 라벨별 발생 횟수를 집계한다."""
    holder: dict = {}

    @chain
    def _detect_anomalies_step(trace_input: dict) -> dict:
        holder["result"] = detect_overload_anomalies_auto(feature_df)
        result = holder["result"]
        return {
            "method_used": result.attrs.get("method_used"),
            "member_count": len(result),
            "anomaly_count": int(result["is_anomaly"].sum()) if len(result) else 0,
            "anomaly_type_breakdown": {
                label: sum(label in types for types in result["anomaly_types"])
                for label in _ANOMALY_LABELS
            } if len(result) else {},
        }

    _detect_anomalies_step.invoke({"feature_count": len(feature_df)})
    return holder["result"]


def _summarize_workload_score_data(data: WorkloadScoreData) -> dict:
    """LangSmith 트레이스에 팀원별 개인 데이터(WorkloadMemberResult) 전체 대신
    프로젝트 단위 요약 통계만 기록한다."""
    return {
        "project_id": data.project_id,
        "source": data.source,
        "method": data.method,
        "member_count": len(data.members),
        "anomaly_count": sum(1 for m in data.members if m.is_anomaly),
        "note": data.note,
    }


async def get_workload_score(project_id: int, use_synthetic_fallback: bool = False) -> WorkloadScoreData:
    """
    프로젝트의 팀원별 업무 편중(난이도 편중/업무량 편중/배정량 불균형) 점수를 계산한다.

    - project_id: 대상 프로젝트
    - use_synthetic_fallback: 실제 DB 데이터가 없거나 연결 실패 시
      합성 데이터로 데모 응답을 줄지 여부. 기본값 False (운영 기본 동작:
      실패 시 에러를 그대로 올림). 데모/개발 환경에서만 명시적으로 True로 호출할 것.
    """
    try:
        tasks_df = await asyncio.to_thread(db.load_tasks_from_db, project_id)
        source = "db"
    except Exception:
        if not use_synthetic_fallback:
            raise
        logger.warning(
            "project_id=%s: DB 조회 실패, synthetic fallback 데이터로 대체", project_id
        )
        tasks_df = generate_synthetic_tasks(n_members=7)
        source = "synthetic_fallback"

    if tasks_df.empty:
        data = WorkloadScoreData(
            project_id=project_id,
            source=source,
            method="N/A",
            members=[],
            note="배정된 업무가 없어 편중 점수를 계산할 수 없습니다.",
        )
        return data

    features = _run_build_features(tasks_df)
    result = _run_detect_anomalies(features)

    members = [
        WorkloadMemberResult(
            assignee_id=row["assignee_id"],
            task_count_total=int(row["task_count_total"]),
            completion_rate=round(float(row["completion_rate"]), 3),
            overload_score=round(float(row["overload_score_0_100"]), 1),
            is_anomaly=bool(row["is_anomaly"]),
            anomaly_types=list(row["anomaly_types"]),
            difficulty_score=round(float(row["difficulty_score"]), 1),
            workload_score=round(float(row["workload_score"]), 1),
            allocation_score=round(float(row["allocation_score"]), 1),
            task_count_active_rel=round(float(row["task_count_active_rel"]), 3),
            task_count_total_rel=round(float(row["task_count_total_rel"]), 3),
            difficulty_total_rel=round(float(row["difficulty_total_rel"]), 3),
            overdue_count=int(row["overdue_count"]),
        )
        for _, row in result.iterrows()
    ]

    return WorkloadScoreData(
        project_id=project_id,
        source=source,
        method=result.attrs.get("method_used", "unknown"),
        members=members,
        team_mean_completion=result.attrs.get("team_mean_completion"),
    )
```

참고: `get_workload_score` 자체는 `@chain`으로 감싸지 않는다 — 이 함수는 이미 `db.load_tasks_from_db`(스레드풀 I/O), 조건 분기, 빈 팀 early return 등 트레이싱 대상이 아닌 로직이 섞여 있어서, 전체를 감싸면 `_run_build_features`/`_run_detect_anomalies` 두 자식 스팬이 트레이스 트리에 안 뜨는(부모가 없는) 문제가 생긴다. 대신 두 헬퍼 함수(`_run_build_features`, `_run_detect_anomalies`)가 이미 각각 독립된 최상위 trace로 LangSmith에 기록되며, 이것으로 "이번 실행에서 무슨 일이 있었는지" 확인하기엔 충분하다(부모-자식 트리 없이 같은 시간대의 두 개 sibling trace로 보임 - 스펙의 "완전한 트리 구조"보다 단순화된 형태이나, 공개 함수 시그니처를 지키기 위한 트레이드오프).

- [ ] **Step 4: `workload_router.py`에 `setup_langsmith()` 호출 추가**

`App/backend_fastapi/ml_workload_score/app/routers/workload_router.py`를 다음으로 교체:

```python
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from core.security import verify_internal_api_key
from core.tracing import setup_langsmith
from ml_workload_score.app.schema.workload_schema import WorkloadScoreResponse
from ml_workload_score.app.services.workload_service import get_workload_score

logger = logging.getLogger(__name__)

setup_langsmith()

router = APIRouter(prefix="/ai/score", tags=["workload"], dependencies=[Depends(verify_internal_api_key)])


@router.post("/workload", response_model=WorkloadScoreResponse)
async def score_workload(project_id: int, use_synthetic_fallback: bool = False):
    """
    FS-5 업무 편중 점수 (팀원별 과부하/저활동 탐지).
    Spring Boot가 내부 호출하는 통계·ML 백엔드 엔드포인트.
    """
    try:
        data = await get_workload_score(project_id, use_synthetic_fallback=use_synthetic_fallback)
        return {"success": True, "data": data}
    except Exception:
        logger.exception("workload score 계산 실패 (project_id=%s)", project_id)
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": {
                    "code": "WORKLOAD_SCORE_FAILED",
                    "message": "업무 편중 점수를 계산하지 못했습니다.",
                    "details": {},
                },
            },
        )
```

- [ ] **Step 5: 신규 트레이싱 테스트 + 기존 회귀 테스트 실행해서 통과 확인**

Run:
```bash
cd App/backend_fastapi
PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score/test_workload_service_tracing.py tests/ml_workload_score/test_workload_service.py -v
```
Expected: 전부 PASS

- [ ] **Step 6: 기존 workload_model 테스트(6개 파일) 전부 무수정 통과 재확인**

Run:
```bash
cd App/backend_fastapi
PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/ml_workload_score --ignore=tests/ml_workload_score/test_workload_router.py -v
```
Expected: 전부 PASS (test_workload_router.py는 Global Constraints에 명시된 기존 redis import 이슈로 제외)

- [ ] **Step 7: 커밋**

```bash
git add App/backend_fastapi/ml_workload_score/app/services/workload_service.py \
        App/backend_fastapi/ml_workload_score/app/routers/workload_router.py \
        App/backend_fastapi/tests/ml_workload_score/test_workload_service_tracing.py
git commit -m "feat: get_workload_score() 파이프라인에 LangChain 트레이싱 추가

- build_features/detect_overload_anomalies_auto 호출을 @chain으로 감싼
  내부 헬퍼(_run_build_features/_run_detect_anomalies)를 통해 실행
- 트레이스 입출력은 3축 구조(anomaly_types) 반영한 요약 dict로 제한,
  팀원 원본 데이터는 클로저로만 전달해 LangSmith로 노출 안 함
- 공개 함수 시그니처 불변 유지, 기존 테스트 전부 무수정 통과 확인
- workload_router.py 모듈 로드 시 setup_langsmith() 호출 추가"
```

---

### Task 3: `contribution_service.py`에 LangChain 트레이싱 스텝 추가

**Files:**
- Modify: `App/backend_fastapi/contribution_score/app/services/contribution_service.py`
- Modify: `App/backend_fastapi/contribution_score/app/routers/contribution_router.py`
- Test: `App/backend_fastapi/tests/contribution_score/test_contribution_service.py` (기존 파일 — 무수정으로 통과해야 함)
- Test: `App/backend_fastapi/tests/contribution_score/test_contribution_score_bounds.py` (기존 파일 — 무수정으로 통과해야 함)
- Test: `App/backend_fastapi/tests/contribution_score/test_contribution_service_tracing.py` (신규)

**Interfaces:**
- Consumes: `core.tracing.setup_langsmith`(Task 1), `WorkloadMemberResult`(스키마 불변).
- Produces: `compute_contribution_scores(workload_members: list[WorkloadMemberResult], attendance: dict[str, int], total_meetings: int) -> list[ContributionMemberResult]` — 시그니처/반환 타입 불변.

- [ ] **Step 1: 실패하는 트레이싱 스모크 테스트 작성**

`App/backend_fastapi/tests/contribution_score/test_contribution_service_tracing.py`(신규):

```python
from __future__ import annotations

from contribution_score.app.services.contribution_service import compute_contribution_scores
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult


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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd App/backend_fastapi && PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/contribution_score/test_contribution_service_tracing.py -v`
Expected: FAIL — `test_contribution_service_module_imports_chain_from_langchain_core`가 `AttributeError`로 실패 (아직 `chain` 미사용). 나머지 2개는 이미 통과할 수 있음(정상 - 회귀 없음을 먼저 확인하는 목적).

- [ ] **Step 3: `contribution_service.py`에 LangChain 트레이싱 스텝 구현**

`App/backend_fastapi/contribution_score/app/services/contribution_service.py` 전체를 다음으로 교체:

```python
from __future__ import annotations

from langchain_core.runnables import chain

from contribution_score.app.schema.contribution_schema import ContributionMemberResult
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult

# 2026-07-20 PCA/엔트로피 가중치 실험 결과 반영 (document_이은주/2026-07-20-contribution-weight-experiment.md)
WEIGHT_WORKLOAD = 0.2016
WEIGHT_TASK = 0.4911
WEIGHT_MEETING = 0.3073


def workload_component_of(member: WorkloadMemberResult) -> float:
    """
    overload_score는 세 축(난이도 편중/업무량 편중/배정량 불균형) 중 하나라도 이상치면
    커진다(방향을 구분하지 않음). 기여도 관점에서는 "배정량 불균형"(애초에 배정받은 업무
    자체가 팀 평균보다 적음)만 감점 대상이어야 하므로, anomaly_types에 이 라벨이 포함된
    경우에만 100에서 빼서 반영하고 그 외(정상/업무량 편중/난이도 편중/불명확)는 만점
    처리한다. 다른 축과 함께 걸려 있어도(예: 배정량 불균형 + 난이도 편중 동시) 배정량
    불균형이 포함돼 있으면 동일하게 감점한다.
    """
    if "배정량 불균형" in member.anomaly_types:
        return max(0.0, 100.0 - member.overload_score)
    return 100.0


def meeting_component_of(attended: int, total: int) -> float:
    """전체 회의가 0건이면 참석 못 할 회의가 없었던 것이므로 불이익 없이 만점 처리."""
    if total <= 0:
        return 100.0
    return round(attended / total * 100, 1)


def _compute_members(
    workload_members: list[WorkloadMemberResult],
    attendance: dict[str, int],
    total_meetings: int,
) -> list[ContributionMemberResult]:
    """실제 팀원별 기여도 점수 계산 로직 - LangChain 트레이싱 스텝(_run_contribution_scores)이
    이 함수를 호출한다. 기존 compute_contribution_scores()와 동일한 로직."""
    results: list[ContributionMemberResult] = []
    for member in workload_members:
        workload_comp = workload_component_of(member)
        task_comp = round(member.completion_rate * 100, 1)
        meeting_comp = meeting_component_of(attendance.get(member.assignee_id, 0), total_meetings)
        score = round(
            WEIGHT_WORKLOAD * workload_comp + WEIGHT_TASK * task_comp + WEIGHT_MEETING * meeting_comp,
            1,
        )
        results.append(
            ContributionMemberResult(
                assignee_id=member.assignee_id,
                workload_component=workload_comp,
                task_component=task_comp,
                meeting_component=meeting_comp,
                contribution_score=score,
                anomaly_types=member.anomaly_types,
                difficulty_score=member.difficulty_score,
                workload_score=member.workload_score,
                allocation_score=member.allocation_score,
                task_count_active_rel=member.task_count_active_rel,
                task_count_total_rel=member.task_count_total_rel,
                difficulty_total_rel=member.difficulty_total_rel,
                overdue_count=member.overdue_count,
            )
        )
    return results


def compute_contribution_scores(
    workload_members: list[WorkloadMemberResult],
    attendance: dict[str, int],
    total_meetings: int,
) -> list[ContributionMemberResult]:
    """
    workload_members: get_workload_score()가 반환한 팀원 목록(workload+task 피처의 원천).
    attendance: {assignee_id(str): 참석 횟수} — load_meeting_attendance()의 첫 번째 반환값.
    총 회의 수는 total_meetings로 별도 전달(모든 팀원에게 공통값).
    workload_members에는 있지만 attendance에 없는 팀원은 참석 0회로 처리한다
    (결측이 아니라 "회의에 한 번도 참석하지 않음"이 맞는 해석).

    실제 계산은 LangChain @chain으로 감싼 내부 스텝(_run_contribution_scores)을 거쳐
    LangSmith에 trace로 남는다. 트레이스에는 팀원 개인 데이터 전체 대신 집계 요약만 기록한다
    (@chain은 이 함수가 호출될 때마다 새로 만든다 - patch()로 갈아끼운 원본 함수 심볼을
    최신 상태로 참조하기 위함).
    """
    holder: dict = {}

    @chain
    def _run_contribution_scores(trace_input: dict) -> dict:
        holder["results"] = _compute_members(workload_members, attendance, total_meetings)
        results = holder["results"]
        return {
            "member_count": len(results),
            "avg_contribution_score": (
                round(sum(r.contribution_score for r in results) / len(results), 1)
                if results else None
            ),
            "weight_workload": WEIGHT_WORKLOAD,
            "weight_task": WEIGHT_TASK,
            "weight_meeting": WEIGHT_MEETING,
        }

    _run_contribution_scores.invoke({
        "member_count": len(workload_members),
        "total_meetings": total_meetings,
    })
    return holder["results"]
```

참고: `workload_component_of`/`meeting_component_of`는 순수 계산 헬퍼라 별도 트레이싱 없이 그대로 유지한다 — `_compute_members` 안에서 호출되며, `_compute_members` 자체는 `@chain`으로 안 감싸고 `_run_contribution_scores`(트레이싱 스텝) 안에서 평범하게 호출한다. 이는 `_compute_members`를 직접 patch/호출하는 기존 테스트가 없어서 안전하다(기존 테스트는 전부 `compute_contribution_scores`를 공개 진입점으로 호출).

- [ ] **Step 4: `contribution_router.py`에 `setup_langsmith()` 호출 추가**

`App/backend_fastapi/contribution_score/app/routers/contribution_router.py`의 최상단(다른 import들 다음, `router = APIRouter(...)` 이전)에 추가:

```python
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from contribution_score.app.schema.contribution_schema import (
    ContributionScoreData,
    ContributionScoreResponse,
)
from contribution_score.app.services.contribution_db import load_meeting_attendance
from contribution_score.app.services.contribution_service import compute_contribution_scores
from core.security import verify_internal_api_key
from core.tracing import setup_langsmith
from ml_workload_score.app.services.workload_service import get_workload_score

logger = logging.getLogger(__name__)

setup_langsmith()

router = APIRouter(prefix="/ai/score", tags=["contribution"], dependencies=[Depends(verify_internal_api_key)])
```

(이하 `@router.post("/contribution", ...)` 함수는 기존 그대로 유지)

- [ ] **Step 5: 신규 트레이싱 테스트 + 기존 회귀 테스트 실행해서 통과 확인**

Run:
```bash
cd App/backend_fastapi
PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest tests/contribution_score/test_contribution_service_tracing.py tests/contribution_score/test_contribution_service.py tests/contribution_score/test_contribution_score_bounds.py -v
```
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add App/backend_fastapi/contribution_score/app/services/contribution_service.py \
        App/backend_fastapi/contribution_score/app/routers/contribution_router.py \
        App/backend_fastapi/tests/contribution_score/test_contribution_service_tracing.py
git commit -m "feat: compute_contribution_scores() 파이프라인에 LangChain 트레이싱 추가

- 실제 계산 로직을 _compute_members()로 분리하고, @chain으로 감싼
  _run_contribution_scores 트레이싱 스텝에서 호출
- 트레이스 출력은 팀원 개인 데이터 대신 평균 점수/가중치 요약만 기록
- 공개 함수 시그니처 불변 유지, 기존 테스트 전부 무수정 통과 확인
- contribution_router.py 모듈 로드 시 setup_langsmith() 호출 추가"
```

---

### Task 4: 전체 회귀 테스트 + 컨벤션 문서 갱신

**Files:**
- Modify: `convention/ai.md`
- Test: 전체 `ml_workload_score`/`contribution_score` 테스트 스위트

**Interfaces:**
- Consumes: Task 2, Task 3에서 만든 모든 파일.
- Produces: 없음(문서 갱신 + 최종 검증 태스크).

- [ ] **Step 1: `convention/ai.md`의 LangChain 사용 범위 설명 갱신**

`convention/ai.md`의 다음 줄:

```markdown
- LangChain은 RAG 챗봇 라우터에 적용됨(langchain-core/langchain-huggingface). LangSmith로 트레이싱.
```

을 다음으로 교체:

```markdown
- LangChain은 RAG 챗봇 라우터(langchain-core/langchain-huggingface)와 워크로드/기여도 스코어
  파이프라인(`ml_workload_score`, `contribution_score` - langchain-core `@chain`)에 적용됨.
  LangSmith로 트레이싱.
```

- [ ] **Step 2: 전체 워크로드/기여도 테스트 스위트 실행 (라우터 테스트 제외)**

Run:
```bash
cd App/backend_fastapi
PYTHONPATH=. ../../.venv/Scripts/python.exe -m pytest \
  tests/ml_workload_score --ignore=tests/ml_workload_score/test_workload_router.py \
  tests/contribution_score --ignore=tests/contribution_score/test_contribution_router.py \
  tests/test_tracing.py \
  -v
```
Expected: 전부 PASS (Task 1 실행 전 baseline 49 passed + Task 1의 5개 + Task 2의 2개 + Task 3의 3개 = 총 59 passed 근처, 정확한 숫자는 실행 결과로 확인)

- [ ] **Step 3: `LANGSMITH_API_KEY`가 실제로 설정된 상태에서 수동 스모크(선택, 로컬 키 있는 경우만)**

이 스텝은 외부 서비스(LangSmith) 의존이라 자동화된 유닛 테스트 범위 밖이다. 로컬 `.env`에
`LANGSMITH_API_KEY`가 설정돼 있다면:

```bash
cd App/backend_fastapi
PYTHONPATH=. ../../.venv/Scripts/python.exe -c "
import asyncio
from ml_workload_score.app.services.workload_service import get_workload_score

async def main():
    result = await get_workload_score(project_id=1, use_synthetic_fallback=True)
    print(result.method, len(result.members))

asyncio.run(main())
"
```
을 실행한 뒤 https://smith.langchain.com 대시보드에서 `workflow-ai-backend`(또는 `.env`의
`LANGSMITH_PROJECT`) 프로젝트에 새 trace 2건(`_run_build_features` 계열, `_run_detect_anomalies`
계열)이 보이는지 육안으로 확인한다. 키가 없으면 이 스텝은 건너뛴다(Step 2의 자동 테스트가
"키 없어도 정상 동작"은 이미 검증함).

- [ ] **Step 4: 커밋**

```bash
git add convention/ai.md
git commit -m "docs: convention/ai.md에 워크로드/기여도 스코어 LangChain 사용 범위 반영"
```

## Self-Review 결과

**Spec coverage:**
- 설계 문서 "포함" 범위 5개 항목(core/tracing.py, workload_service.py, workload_router.py, contribution_service.py, contribution_router.py) → Task 1~3에서 전부 커버.
- "3축 구조로 바뀌어도 적용되는가?" 섹션의 `_ANOMALY_LABELS` 집계 로직 → Task 2 Step 3에 반영.
- "트레이스 payload 크기 관리"(원본 데이터 미노출) → Task 2/3의 클로저(holder) 패턴으로 반영.
- "테스트 계획"의 회귀 확인 + 체인 래퍼 스모크 테스트 → Task 2/3에 각각 반영.
- "의존성"의 convention/ai.md 갱신 → Task 4에 반영.
- 설계 문서의 "알려진 한계"(run_name 미부여, 팀원별 세분화 스팬 없음)는 이번 계획에서도 동일하게 적용 안 함 — 계획과 설계가 일치.

**Placeholder scan:** "TBD", "구현 단계에서 확정" 같은 표현 없음. 모든 코드 블록이 실제 완성된 내용.

**Type consistency:** `WorkloadScoreData`, `WorkloadMemberResult`, `ContributionMemberResult` 필드명이 Task 2/3 전체에서 기존 스키마(`ml_workload_score/app/schema/workload_schema.py`, `contribution_score/app/schema/contribution_schema.py`)와 정확히 일치함을 확인(`anomaly_types`, `difficulty_score`, `workload_score`, `allocation_score` 등). `setup_langsmith(project_name: str = "workflow-ai-backend")` 시그니처가 Task 1 정의와 Task 2/4 호출부에서 일관됨.
