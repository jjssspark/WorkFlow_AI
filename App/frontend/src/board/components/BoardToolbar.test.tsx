import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardToolbar } from "./BoardToolbar";

const mockUseAuth = vi.fn();
vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("BoardToolbar 업무 생성 버튼", () => {
  it("팀장이면 '새 업무' 버튼이 보인다", () => {
    mockUseAuth.mockReturnValue({ currentProject: { projectId: 1, projectTitle: "데모", role: "팀장" } });
    render(<BoardToolbar tasks={[]} onAddTask={vi.fn()} />);
    expect(screen.getByText("새 업무")).toBeInTheDocument();
  });

  it("팀원이면 '새 업무' 버튼이 보이지 않는다", () => {
    mockUseAuth.mockReturnValue({ currentProject: { projectId: 1, projectTitle: "데모", role: "팀원" } });
    render(<BoardToolbar tasks={[]} onAddTask={vi.fn()} />);
    expect(screen.queryByText("새 업무")).not.toBeInTheDocument();
  });

  it("심사자면 '새 업무' 버튼이 보이지 않는다", () => {
    mockUseAuth.mockReturnValue({ currentProject: { projectId: 1, projectTitle: "데모", role: "심사자" } });
    render(<BoardToolbar tasks={[]} onAddTask={vi.fn()} />);
    expect(screen.queryByText("새 업무")).not.toBeInTheDocument();
  });
});
