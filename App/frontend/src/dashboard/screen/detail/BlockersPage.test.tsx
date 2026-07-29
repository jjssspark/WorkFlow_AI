import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockersPage } from "./BlockersPage";

const authState = vi.hoisted(() => ({ role: "팀원" }));

vi.mock("../../../global/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 2, name: "이서연", email: "member@test.com" },
    currentProjectId: 1,
    currentProject: { projectId: 1, projectTitle: "테스트 프로젝트", role: authState.role },
  }),
}));

vi.mock("../../libs/hooks/useDashboardTasks", () => ({
  useDashboardTasks: () => ({
    data: [{
      id: "TASK-1",
      title: "배포 환경 점검",
      category: "DEVOPS",
      status: "blocked",
      assigneeId: "2",
      assigneeName: "이서연",
      dueDate: "2026-07-30",
      doneDate: null,
      priority: "HIGH",
      description: "인증서 설정 확인 필요",
      sourceType: "MANUAL",
      position: 1,
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-27T00:00:00Z",
    }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../libs/hooks/useDashboardProgress", () => ({
  useDashboardProgress: () => ({ data: { delayRisks: [] }, loading: false }),
}));

vi.mock("../../../global/api/projectsApi", () => ({
  getProjectMembers: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("../../components/TaskDueDatePopup", () => ({ TaskDueDatePopup: () => null }));
vi.mock("../../components/TaskDetailPopup", () => ({ TaskDetailPopup: () => null }));
vi.mock("../../../board/components/AddTaskModal", () => ({ AddTaskModal: () => null }));

const renderPage = () => render(
  <MemoryRouter>
    <BlockersPage />
  </MemoryRouter>
);

describe("BlockersPage 마감일 조정 권한", () => {
  beforeEach(() => {
    authState.role = "팀원";
  });

  it("팀원에게는 마감일 조정 버튼을 노출하지 않는다", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "마감일 조정" })).not.toBeInTheDocument();
  });

  it("팀장에게는 마감일 조정 버튼을 노출한다", () => {
    authState.role = "팀장";
    renderPage();
    expect(screen.getByRole("button", { name: "마감일 조정" })).toBeInTheDocument();
  });
});
