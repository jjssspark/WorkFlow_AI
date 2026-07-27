from __future__ import annotations

from contribution_score.app.schema.contribution_schema import ContributionMemberResult
from ml_workload_score.app.schema.workload_schema import WorkloadMemberResult

# 2026-07-20 PCA/엔트로피 가중치 실험 결과 반영 (document_이은주/2026-07-20-contribution-weight-experiment.md)
WEIGHT_WORKLOAD = 0.2016
WEIGHT_TASK = 0.4911
WEIGHT_MEETING = 0.3073


def workload_component_of(member: WorkloadMemberResult) -> float:
    """
    overload_score는 과부하든 배정량 불균형이든 이상치면 값이 커진다(방향을 구분하지 않음).
    기여도 관점에서는 배정량 불균형(애초에 배정받은 업무 자체가 팀 평균보다 적음)만
    감점 대상이어야 하므로, 그 경우에만 100에서 빼서 반영하고 그 외(정상/과부하/불명확)는
    만점 처리한다.
    """
    if member.anomaly_type == "배정량 불균형":
        return max(0.0, 100.0 - member.overload_score)
    return 100.0


def meeting_component_of(attended: int, total: int) -> float:
    """전체 회의가 0건이면 참석 못 할 회의가 없었던 것이므로 불이익 없이 만점 처리."""
    if total <= 0:
        return 100.0
    return round(attended / total * 100, 1)


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
    """
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
                anomaly_type=member.anomaly_type,
                task_count_active_rel=member.task_count_active_rel,
                task_count_total_rel=member.task_count_total_rel,
                difficulty_avg_rel=member.difficulty_avg_rel,
                overdue_count=member.overdue_count,
            )
        )
    return results
