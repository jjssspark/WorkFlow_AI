from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from ml_delay_risk.models import delay_model
from ml_delay_risk.services.delay_service import build_feature_row, predict_for_task_row


def _make_task_row(**overrides) -> pd.Series:
    base = {
        "task_id": 5,
        "project_id": 1,
        "milestone_id": float("nan"),
        "title": "결제 시스템 연동",
        "category": "백엔드",
        "status": "inprogress",
        "assignee_id": 4,
        "due_date": pd.NaT,
        "priority": "높음",
        "created_at": pd.Timestamp(2026, 7, 1, 9, 0, 0),
        "updated_at": pd.Timestamp(2026, 7, 10, 9, 0, 0),
        "milestone_due_date": pd.NaT,
        "checklist_total": 4,
        "checklist_done": 1,
    }
    base.update(overrides)
    return pd.Series(base)


def test_build_feature_row_maps_status_to_jira_like_status() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(status="blocked", due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))

    features = build_feature_row(row, now=now, milestone_completion={})

    assert features["status_at_cutoff"] == "Blocked"
    # 블로커 상태이므로 마지막 수정 시각(now - updated_at) 만큼 blocked_hours로 잡혀야 한다.
    assert features["blocked_hours_before_cutoff"] > 0
    assert features["assignee_at_cutoff"] == "4"


def test_build_feature_row_uses_real_due_date_as_proxy_deadline() -> None:
    created = datetime(2026, 7, 1, 0, 0, 0)
    due = pd.Timestamp(2026, 7, 11, 0, 0, 0)  # created로부터 10일(240시간) 뒤
    now = datetime(2026, 7, 6, 0, 0, 0)  # created로부터 5일(120시간) 경과
    row = _make_task_row(created_at=pd.Timestamp(created), due_date=due, checklist_total=0, checklist_done=0)

    features = build_feature_row(row, now=now, milestone_completion={})

    assert features["elapsed_hours_at_cutoff"] == 120.0
    assert features["hours_until_deadline_at_cutoff"] == 120.0  # 240 - 120
    assert features["elapsed_ratio_at_cutoff"] == 0.5
    # 체크리스트가 없는 업무는 진행률을 알 수 없으므로 None (0으로 조작하지 않음).
    assert features["progress_ratio_at_cutoff"] is None
    assert features["imbalance_index_at_cutoff"] is None
    # snapshot_offset_days는 Jira 학습 데이터에서는 정수 스냅샷(1/3/7/14/30)이었지만,
    # 실시간 추론에서는 "생성 후 경과일"을 연속값으로 근사한다(120시간 = 5일).
    assert features["snapshot_offset_days"] == 5.0


def test_build_feature_row_computes_progress_ratio_from_checklist() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(
        due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0),
        checklist_total=4,
        checklist_done=3,
    )

    features = build_feature_row(row, now=now, milestone_completion={})

    assert features["progress_ratio_at_cutoff"] == 0.75
    assert features["num_subtasks"] == 4
    assert features["num_unresolved_subtasks"] == 1


def test_build_feature_row_defaults_jira_only_fields_safely() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))

    features = build_feature_row(row, now=now, milestone_completion={})

    # Jira 전용(issuelinks/worklog/댓글/재배정 이력 등) 피처는 이 스키마에 대응 개념이
    # 없으므로 학습 분포와 맞는 안전한 기본값(0/False)으로 채워져야 한다.
    assert features["num_issuelinks_total"] == 0
    assert features["num_blocked_by_links"] == 0
    assert features["num_worklog_entries"] == 0
    assert features["num_comments_before_cutoff"] == 0
    assert features["has_original_estimate"] is False
    assert features["is_self_assigned"] is False


def test_build_feature_row_flags_milestone_unresolved_when_milestone_incomplete() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(milestone_id=7.0, due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))

    features = build_feature_row(row, now=now, milestone_completion={7: 0.5})

    assert features["milestone_id"] == 7
    assert features["has_milestone"] is True
    assert features["milestone_unresolved"] is True

    features_done = build_feature_row(row, now=now, milestone_completion={7: 1.0})
    assert features_done["milestone_unresolved"] is False


def test_build_feature_row_computes_comment_stats_from_real_task_comments() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))
    comments = pd.DataFrame(
        {
            "author_id": [1, 2, 1],
            "created_at": [
                pd.Timestamp(2026, 7, 5, 0, 0, 0),
                pd.Timestamp(2026, 7, 8, 0, 0, 0),
                pd.Timestamp(2026, 7, 20, 0, 0, 0),  # cutoff(now) 이후 — 제외돼야 함
            ],
        }
    )

    features = build_feature_row(row, now=now, milestone_completion={}, comments=comments)

    # cutoff 이후 댓글(7/20)은 제외하고 cutoff 이전 2건(7/5, 7/8)만 집계돼야 한다.
    assert features["num_comments_before_cutoff"] == 2
    assert features["num_unique_commenters"] == 2
    # 마지막 유효 댓글(7/8 00:00) 기준 경과 시간 — 7/12 09:00까지 4일 9시간 = 105시간.
    assert features["hours_since_last_comment"] == 105.0


def test_build_feature_row_computes_event_count_from_real_activities() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))
    activities = pd.DataFrame(
        {
            "created_at": [
                pd.Timestamp(2026, 7, 2, 0, 0, 0),
                pd.Timestamp(2026, 7, 11, 0, 0, 0),  # 최근 활동 윈도우(기본 3일) 안
                pd.Timestamp(2026, 7, 20, 0, 0, 0),  # cutoff(now) 이후 — 제외돼야 함
            ]
        }
    )

    features = build_feature_row(row, now=now, milestone_completion={}, activities=activities)

    assert features["num_events_before_cutoff"] == 2
    # 최근 3일(recent_activity_window_days) 안에 든 이벤트(7/11) 1건만 카운트.
    assert features["activity_count_recent_window"] == 1


def test_build_feature_row_activity_count_recent_window_combines_comments_and_events() -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))
    comments = pd.DataFrame({"author_id": [1], "created_at": [pd.Timestamp(2026, 7, 11, 0, 0, 0)]})
    activities = pd.DataFrame({"created_at": [pd.Timestamp(2026, 7, 11, 12, 0, 0)]})

    features = build_feature_row(
        row, now=now, milestone_completion={}, comments=comments, activities=activities
    )

    assert features["activity_count_recent_window"] == 2


def test_build_feature_row_without_comments_or_activities_defaults_to_zero() -> None:
    """comments/activities를 안 넘기는 기존 호출부(단위 테스트 등)도 그대로 동작해야 한다."""
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))

    features = build_feature_row(row, now=now, milestone_completion={})

    assert features["num_comments_before_cutoff"] == 0
    assert features["num_unique_commenters"] == 0
    assert features["num_events_before_cutoff"] == 0
    assert features["activity_count_recent_window"] == 0


def test_predict_for_task_row_maps_risk_class_to_korean_result(monkeypatch) -> None:
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))

    monkeypatch.setattr(delay_model, "predict_class_probabilities", lambda feature_row: [0.1, 0.2, 0.7])

    prediction = predict_for_task_row(row, now=now, milestone_completion={})

    assert prediction["task_id"] == 5
    assert prediction["risk_class"] == "DANGER"
    assert prediction["result"] == "위험"
    assert prediction["score"] == 0.7


def test_predict_for_task_row_maps_the_lowest_risk_distribution_to_normal(monkeypatch) -> None:
    """위 테스트('위험')의 대조군이다.

    없으면 라벨을 항상 DANGER로 돌려주도록 바꿔도 위 테스트는 그대로 통과한다 - 모든 업무가
    빨간 '위험'으로 표시되는 화면이 되는데 테스트는 초록불이다. 확률 분포에서 가장 큰 쪽을
    고르는 argmax가 실제로 동작하는지는 서로 다른 정답 두 개를 대봐야만 확인된다.
    """
    now = datetime(2026, 7, 12, 9, 0, 0)
    row = _make_task_row(due_date=pd.Timestamp(2026, 7, 20, 0, 0, 0))

    monkeypatch.setattr(delay_model, "predict_class_probabilities", lambda feature_row: [0.7, 0.2, 0.1])

    prediction = predict_for_task_row(row, now=now, milestone_completion={})

    assert prediction["risk_class"] == "NORMAL"
    assert prediction["result"] == "정상"
    assert prediction["score"] == 0.7
