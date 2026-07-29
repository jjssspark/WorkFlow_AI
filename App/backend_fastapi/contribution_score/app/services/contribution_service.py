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
