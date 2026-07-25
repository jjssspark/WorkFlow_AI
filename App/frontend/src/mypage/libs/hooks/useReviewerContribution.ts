import { useCallback, useEffect, useRef, useState } from "react";
import { getProjectMembers } from "../../../global/api/projectsApi";
import { fetchContributionReport, fetchContributionScore } from "../../../contributors/libs/utils/contributorsApi";
import { fetchTasks } from "../../../board/libs/utils/taskApi";
import { fetchAttendanceSummary } from "../../../meetings/libs/utils/meetingAiApi";

export type ReviewerContributionLoadState = "loading" | "ready" | "error";

export interface ReviewerContributionRow {
  userId: number;
  name: string;
  role: string;
  todoDone: number;
  todoTotal: number;
  meetings: number;
  meetingsTotal: number;
  aiSummary: string | null;
  evidence: string[];
  score: number | null;
  categories: { task: number; meeting: number; workload: number } | null;
  isPublic: false;
}

export function useReviewerContribution(projectId: number | null) {
  const [rows, setRows] = useState<ReviewerContributionRow[]>([]);
  const [loadState, setLoadState] = useState<ReviewerContributionLoadState>("loading");
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    if (projectId === null) {
      requestIdRef.current += 1;
      setRows([]);
      setLoadState("ready");
      return;
    }
    const requestId = (requestIdRef.current += 1);
    setLoadState("loading");
    Promise.all([
      getProjectMembers(projectId),
      fetchContributionReport(projectId),
      fetchContributionScore(projectId),
      fetchTasks(projectId),
      fetchAttendanceSummary(String(projectId)),
    ])
      .then(([members, reports, scoreResult, tasks, attendance]) => {
        if (requestIdRef.current !== requestId) return;
        const reportByUserId = new Map(reports.map((r) => [String(r.userId), r]));
        const scoreByUserId = new Map(scoreResult.members.map((s) => [s.assigneeId, s]));
        const attendanceByUserId = new Map(attendance.map((a) => [String(a.userId), a]));

        const merged = members.map((member): ReviewerContributionRow => {
          const key = String(member.userId);
          const report = reportByUserId.get(key) ?? null;
          const score = scoreByUserId.get(key) ?? null;
          const attendanceSummary = attendanceByUserId.get(key) ?? null;
          const memberTasks = tasks.filter((task) => task.assignee === key);

          return {
            userId: member.userId,
            name: member.name,
            role: member.role,
            todoDone: memberTasks.filter((task) => task.status === "done").length,
            todoTotal: memberTasks.length,
            meetings: attendanceSummary?.meetingsAttended ?? 0,
            meetingsTotal: attendanceSummary?.totalMeetings ?? 0,
            aiSummary: report?.summary ?? null,
            evidence: report?.evidence ?? [],
            score: score ? Math.round(score.contributionScore) : null,
            categories: score
              ? { task: score.taskComponent, meeting: score.meetingComponent, workload: score.workloadComponent }
              : null,
            isPublic: false,
          };
        });

        setRows(merged);
        setLoadState("ready");
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setRows([]);
        setLoadState("error");
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, loadState, reload: load };
}
