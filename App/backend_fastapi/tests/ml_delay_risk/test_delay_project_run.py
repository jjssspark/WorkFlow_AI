"""UT-157/162/167: 프로젝트 단위 예측 실행의 대상 선정·저장·실패 정책.

기존 test_delay_service.py는 업무 1건을 피처로 바꾸는 부분(build_feature_row)과 확률을 라벨로
바꾸는 부분(predict_for_task_row)까지만 본다. 그 둘을 묶어 "프로젝트의 어떤 업무를 대상으로
골라, 결과를 어디에 넣고, 한 건이 실패하면 나머지는 어떻게 되는가"를 정하는 것은
run_delay_risk_for_project이고, 이 함수에는 지금까지 테스트가 없었다.
"""
from __future__ import annotations

import pandas as pd
import pytest

from ml_delay_risk.models import delay_model
from ml_delay_risk.services import delay_service
from ml_delay_risk.services.delay_service import run_delay_risk_for_project


FIRST_TASK_TITLE = "첫"
SECOND_TASK_TITLE = "두 번째 업무"


def _tasks_df(rows: list[dict]) -> pd.DataFrame:
    base = {
        "project_id": 1, "milestone_id": float("nan"), "title": "업무",
        "category": "백엔드", "assignee_id": 4, "due_date": pd.NaT, "priority": "높음",
        "created_at": pd.Timestamp(2026, 7, 1, 9, 0, 0),
        "updated_at": pd.Timestamp(2026, 7, 10, 9, 0, 0),
        "milestone_due_date": pd.NaT, "checklist_total": 4, "checklist_done": 1,
    }
    return pd.DataFrame([{**base, **row} for row in rows])


@pytest.fixture
def stub_db(monkeypatch):
    """DB 접근을 전부 대체하고, insert_predictions에 넘어온 것을 그대로 붙잡아 둔다."""
    saved: list[dict] = []

    monkeypatch.setattr(delay_service, "get_engine", lambda: object())
    monkeypatch.setattr(delay_service, "load_task_comments_for_project",
                        lambda project_id, engine: pd.DataFrame())
    monkeypatch.setattr(delay_service, "load_task_activities_for_project",
                        lambda project_id, engine: pd.DataFrame())
    monkeypatch.setattr(delay_service, "insert_predictions",
                        lambda project_id, predictions, engine: saved.extend(predictions))
    # build_feature_row가 마감일이 없을 때 아티팩트의 proxy_deadline_map을 찾아 읽는다.
    # 학습된 모델 파일이 없는 환경에서도 돌아가도록 조회 함수를 대체한다.
    monkeypatch.setattr(delay_model, "proxy_deadline_for", lambda category, priority: 72.0)
    return saved


def _stub_tasks(monkeypatch, tasks_df: pd.DataFrame) -> None:
    monkeypatch.setattr(delay_service, "load_tasks_for_project", lambda project_id, engine: tasks_df)


def test_only_unfinished_tasks_are_predicted_and_saved(stub_db, monkeypatch):
    """UT-157. 완료된 업무는 예측 대상이 아니다.

    완료 업무까지 예측하면 "이미 끝난 일이 지연 위험"으로 화면에 뜬다. 반대로 저장을 빼먹으면
    Spring 대시보드가 읽는 ml_predictions가 갱신되지 않아, 재분석 버튼을 눌러도 화면이 그대로다.
    """
    _stub_tasks(monkeypatch, _tasks_df([
        {"task_id": 1, "status": "inprogress"},
        {"task_id": 2, "status": "done"},
        {"task_id": 3, "status": "todo"},
    ]))
    monkeypatch.setattr(delay_model, "predict_class_probabilities", lambda feature_row: [0.1, 0.2, 0.7])

    predictions = run_delay_risk_for_project(1)

    assert [p["task_id"] for p in predictions] == [1, 3]
    assert [p["result"] for p in predictions] == ["위험", "위험"]
    # 반환만 하고 저장하지 않으면 대시보드에는 아무 변화가 없다.
    assert [p["task_id"] for p in stub_db] == [1, 3]


def test_nothing_is_saved_when_every_task_is_already_done(stub_db, monkeypatch):
    """대상이 없으면 빈 결과를 돌려주고 DB도 건드리지 않는다."""
    _stub_tasks(monkeypatch, _tasks_df([{"task_id": 1, "status": "done"}]))

    assert run_delay_risk_for_project(1) == []
    assert stub_db == []


def test_feature_dict_key_order_does_not_change_the_prediction(monkeypatch):
    """UT-162. 같은 값이면 키 순서가 달라도 같은 결과가 나와야 한다.

    피처 딕셔너리는 build_feature_row가 만들지만 순서가 계약으로 고정돼 있지는 않다. 모델은
    학습 당시의 컬럼 순서대로 입력을 받아야 하므로, predict 쪽에서 아티팩트의 feature_names로
    다시 정렬하지 않으면 순서가 어긋난 채 추론돼 조용히 다른 확률이 나온다 - 예외가 없어서
    화면상으로는 그냥 "예측이 이상하다"로만 보인다.
    """
    import lightgbm as lgb

    train_x = pd.DataFrame({
        "elapsed_hours_at_cutoff": [1.0, 10.0, 40.0, 80.0],
        "summary_length": [80.0, 60.0, 20.0, 5.0],
    })
    booster = lgb.train(
        {"objective": "multiclass", "num_class": 3, "verbosity": -1,
         "min_data_in_leaf": 1, "min_data_in_bin": 1},
        lgb.Dataset(train_x, label=[0, 0, 1, 2]),
        num_boost_round=5,
    )
    monkeypatch.setattr(delay_model, "_artifact_cache", delay_model.ModelArtifact(
        booster=booster,
        feature_names=["elapsed_hours_at_cutoff", "summary_length"],
        categorical_columns=[],
        frequency_maps={},
        proxy_deadline_map={},
        global_median_duration_hours=72.0,
    ))

    in_order = delay_model.predict_class_probabilities(
        {"elapsed_hours_at_cutoff": 50.0, "summary_length": 12.0}
    )
    reversed_order = delay_model.predict_class_probabilities(
        {"summary_length": 12.0, "elapsed_hours_at_cutoff": 50.0}
    )

    assert in_order == reversed_order


def test_a_single_failing_task_aborts_the_whole_run_and_saves_nothing(stub_db, monkeypatch):
    """UT-167의 현재 동작을 고정해 둔다 - 건별 격리는 구현돼 있지 않다.

    run_delay_risk_for_project는 예측을 리스트 컴프리헨션으로 한 번에 만들고 그 뒤에 저장한다.
    따라서 업무 한 건이 예외를 던지면 나머지 성공분까지 버려지고 ml_predictions에는 아무것도
    들어가지 않는다. 사양(UT-167)은 성공/실패 건수를 나누고 성공분은 저장하기를 요구하므로
    이 케이스는 FAIL로 기록했다. 여기서는 "지금은 이렇게 동작한다"만 남긴다 - 나중에 격리를
    구현하면 이 테스트가 빨간불로 바뀌므로, 그때 이 테스트와 시트를 함께 고치면 된다.
    """
    _stub_tasks(monkeypatch, _tasks_df([
        {"task_id": 1, "status": "todo"},
        {"task_id": 2, "status": "todo"},
    ]))

    def explode_on_second_task(feature_row):
        if feature_row["summary_length"] == len(SECOND_TASK_TITLE):
            raise ValueError("피처가 유효하지 않습니다")
        return [0.7, 0.2, 0.1]

    monkeypatch.setattr(delay_model, "predict_class_probabilities", explode_on_second_task)
    monkeypatch.setattr(delay_service, "load_tasks_for_project", lambda project_id, engine: _tasks_df([
        {"task_id": 1, "status": "todo", "title": FIRST_TASK_TITLE},
        {"task_id": 2, "status": "todo", "title": SECOND_TASK_TITLE},
    ]))

    with pytest.raises(ValueError):
        run_delay_risk_for_project(1)

    assert stub_db == []
