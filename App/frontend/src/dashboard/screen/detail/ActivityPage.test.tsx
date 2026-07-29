import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityPage } from "./ActivityPage";

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../../global/hooks/useAuth", () => ({
  useAuth: () => ({ currentProjectId: 7 }),
}));

vi.mock("../../libs/hooks/useDashboardActivities", () => ({
  useDashboardActivities: () => ({
    data: [
      {
        id: "activity-1",
        type: "TASK_CREATED",
        actorId: "user-1",
        actorName: "김민준",
        message: "배포 업무 생성",
        targetId: "task-1",
        createdAt: new Date().toISOString(),
      },
      {
        id: "activity-2",
        type: "CHECKLIST_COMPLETED",
        actorId: "user-2",
        actorName: "이서연",
        message: "체크리스트 완료",
        targetId: "task-2",
        createdAt: new Date().toISOString(),
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe("ActivityPage 활동 통계", () => {
  it("최근 활동을 업무와 체크리스트 통계에 반영한다", () => {
    render(<ActivityPage />);

    expect(screen.getByText("이번 주 전체").parentElement).toHaveTextContent("2");
    expect(screen.getByText("업무 활동").parentElement).toHaveTextContent("1");
    expect(screen.getByText("체크리스트 활동").parentElement).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: /AI 분석/ })).not.toBeInTheDocument();
  });
});
