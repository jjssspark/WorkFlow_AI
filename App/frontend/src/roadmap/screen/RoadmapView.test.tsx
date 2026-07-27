import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoadmapView } from "./RoadmapView";

const fetchRoadmap = vi.fn();
const createMilestone = vi.fn();
const deleteMilestone = vi.fn();
const moveRoadmapTask = vi.fn();
const updateRoadmapTaskPosition = vi.fn();
const fetchChecklist = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../libs/utils/roadmapApi", () => ({
  fetchRoadmap: (...args: unknown[]) => fetchRoadmap(...args),
  createMilestone: (...args: unknown[]) => createMilestone(...args),
  deleteMilestone: (...args: unknown[]) => deleteMilestone(...args),
  moveRoadmapTask: (...args: unknown[]) => moveRoadmapTask(...args),
  updateRoadmapTaskPosition: (...args: unknown[]) => updateRoadmapTaskPosition(...args),
}));

vi.mock("../../board/libs/utils/checklistApi", () => ({
  fetchChecklist: (...args: unknown[]) => fetchChecklist(...args),
}));

const response = {
  project: { id: "1", title: "WorkFlow AI", startDate: "2026-07-01", deadline: "2026-07-31" },
  milestones: [{
    id: "2",
    title: "통합 테스트",
    startDate: "2026-07-17",
    dueDate: "2026-07-28",
    taskCount: 1,
    doneCount: 0,
    progressPercent: 0,
    tasks: [{
      id: "10", milestoneId: "2", title: "E2E 테스트", category: "qa", status: "todo",
      assigneeId: null, assigneeName: null, startDate: "2026-07-21", dueDate: "2026-07-28",
      priority: "medium", position: 0,
    }],
  }],
  unassignedTasks: [],
};

function renderRoadmap() {
  return render(
    <MemoryRouter>
      <RoadmapView />
    </MemoryRouter>,
  );
}

describe("RoadmapView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseAuth.mockReturnValue({
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "WorkFlow AI", role: "팀장" },
      projectContextReady: true,
    });
    fetchRoadmap.mockResolvedValue(structuredClone(response));
    fetchChecklist.mockResolvedValue([]);
    moveRoadmapTask.mockResolvedValue({});
    deleteMilestone.mockResolvedValue(undefined);
    updateRoadmapTaskPosition.mockResolvedValue({});
    createMilestone.mockImplementation((_projectId, input) => Promise.resolve({
      id: `recommended-${input.title}`,
      title: input.title,
      startDate: input.startDate,
      dueDate: input.dueDate,
      taskCount: 0,
      doneCount: 0,
      progressPercent: 0,
      tasks: [],
    }));
  });

  it("renders tasks grouped under their milestone", async () => {
    renderRoadmap();

    expect(await screen.findByText("통합 테스트")).toBeInTheDocument();
    expect(screen.getByText("E2E 테스트", { selector: ".block.text-xs" })).toBeInTheDocument();
    const milestoneBar = screen.getByLabelText(/통합 테스트 마일스톤 기간/);
    expect(milestoneBar).toHaveClass("rounded-full");
    expect(milestoneBar.firstElementChild).toHaveClass("rounded-full");
    expect(screen.getByRole("button", { name: /1단계.*통합 테스트/ }).parentElement).toHaveClass("sticky", "left-0");
    expect(document.querySelector("[data-roadmap-column-header]")).toHaveClass("z-50");

    fireEvent.click(screen.getByRole("button", { name: "주" }));
    expect(screen.getByText("1주차")).toBeInTheDocument();
    expect(screen.getByText("2주차")).toBeInTheDocument();
    expect(screen.getByText("1주차").closest(".w-full.relative")).toHaveStyle({ minWidth: "1020px" });
  });

  it("keeps task names outside schedule bars and fixes date sorting after re-entry", async () => {
    const firstView = renderRoadmap();

    await screen.findByText("통합 테스트");
    expect(screen.getByLabelText("E2E 테스트 일정 막대")).toHaveTextContent("미배정");
    expect(screen.getByLabelText("상태 색상 안내")).toHaveTextContent("할 일진행 중막힘완료");

    const sortButton = screen.getByRole("button", { name: /날짜순 정렬/ });
    fireEvent.click(sortButton);

    expect(localStorage.getItem("roadmap:schedule-sort:1")).toBe("true");
    expect(sortButton).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("날짜순 정렬을 이 프로젝트의 고정 보기로 저장했습니다.")).toBeInTheDocument();

    firstView.unmount();
    renderRoadmap();
    await screen.findByText("통합 테스트");
    expect(screen.getByRole("button", { name: /날짜순 정렬/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not render the quick task creation control", async () => {
    renderRoadmap();
    await screen.findByText("통합 테스트");

    expect(screen.queryByRole("button", { name: /업무 바로 추가/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("업무명 입력 후 Enter")).not.toBeInTheDocument();
  });

  it("shows task details and checklist in a schedule bar hover card", async () => {
    fetchRoadmap.mockResolvedValue({
      ...structuredClone(response),
      milestones: [{
        ...structuredClone(response.milestones[0]),
        tasks: [{
          ...structuredClone(response.milestones[0].tasks[0]),
          description: "로그인 성공과 실패 시나리오를 검증합니다.",
        }],
      }],
    });
    fetchChecklist.mockResolvedValue([
      { id: "c1", label: "성공 케이스 확인", done: true },
      { id: "c2", label: "실패 케이스 확인", done: false },
    ]);
    renderRoadmap();

    const bar = await screen.findByLabelText("E2E 테스트 일정 막대");
    fireEvent.mouseEnter(bar);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("로그인 성공과 실패 시나리오를 검증합니다.");
    expect(fetchChecklist).toHaveBeenCalledWith("10", 1);
    expect(await screen.findByText("성공 케이스 확인")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("1/2 완료");
  });

  it("deletes a stage and keeps its tasks in the unassigned section", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderRoadmap();
    await screen.findByText("통합 테스트");

    fireEvent.click(screen.getByRole("button", { name: "통합 테스트 단계 삭제" }));

    expect(confirm).toHaveBeenCalledWith(
      "\"통합 테스트\" 단계를 삭제할까요?\n이 단계의 업무 1개는 삭제되지 않고 단계 미지정으로 이동합니다.",
    );
    await waitFor(() => expect(deleteMilestone).toHaveBeenCalledWith(1, "2"));
    expect(screen.queryByRole("button", { name: /통합 테스트.*단계/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /단계 미지정/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /E2E 테스트/ })).toBeInTheDocument();
    expect(await screen.findByText(/업무 1개를 단계 미지정으로 이동했습니다/)).toBeInTheDocument();

    confirm.mockRestore();
  });

  it("moves Shift-selected tasks together to a stage drop zone", async () => {
    fetchRoadmap.mockResolvedValue({
      ...structuredClone(response),
      milestones: [
        {
          ...structuredClone(response.milestones[0]),
          tasks: [
            ...structuredClone(response.milestones[0].tasks),
            {
              ...structuredClone(response.milestones[0].tasks[0]),
              id: "11",
              title: "접근성 테스트",
              position: 1,
            },
          ],
        },
        {
          id: "3",
          title: "배포",
          startDate: "2026-07-29",
          dueDate: "2026-07-31",
          taskCount: 0,
          doneCount: 0,
          progressPercent: 0,
          tasks: [],
        },
      ],
    });
    const { container } = renderRoadmap();

    const firstTask = await screen.findByRole("button", { name: /E2E 테스트/ });
    fireEvent.click(firstTask, { shiftKey: true });
    const secondTask = screen.getByRole("button", { name: /접근성 테스트/ });
    fireEvent.click(secondTask, { shiftKey: true });
    expect(screen.getByText(/2개 선택됨/)).toBeInTheDocument();

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    fireEvent.dragStart(screen.getByRole("button", { name: /E2E 테스트/ }), { dataTransfer });
    const target = container.querySelector<HTMLElement>('[data-drop-target="3"]')!;
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    await waitFor(() => {
      expect(moveRoadmapTask).toHaveBeenCalledWith(1, "10", "3");
      expect(moveRoadmapTask).toHaveBeenCalledWith(1, "11", "3");
    });
  });

  it("reorders tasks inside the same stage by dropping below another task", async () => {
    fetchRoadmap.mockResolvedValue({
      ...structuredClone(response),
      milestones: [{
        ...structuredClone(response.milestones[0]),
        tasks: [
          ...structuredClone(response.milestones[0].tasks),
          {
            ...structuredClone(response.milestones[0].tasks[0]),
            id: "11",
            title: "접근성 테스트",
            position: 1,
          },
        ],
      }],
    });
    renderRoadmap();

    const firstTask = await screen.findByRole("button", { name: /E2E 테스트/ });
    const secondTask = screen.getByRole("button", { name: /접근성 테스트/ });
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    fireEvent.dragStart(firstTask, { dataTransfer });
    const currentSecondTask = screen.getByRole("button", { name: /접근성 테스트/ });
    vi.spyOn(currentSecondTask, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40,
      toJSON: () => ({}),
    });
    fireEvent.dragOver(currentSecondTask, { dataTransfer, clientY: 39 });
    fireEvent.drop(currentSecondTask, { dataTransfer, clientY: 39 });

    await waitFor(() => {
      expect(updateRoadmapTaskPosition).toHaveBeenCalledWith(1, "11", "todo", 0);
      expect(updateRoadmapTaskPosition).toHaveBeenCalledWith(1, "10", "todo", 1);
    });
    expect(moveRoadmapTask).not.toHaveBeenCalled();
  });

  it("edits and adds recommended project stages before creating them", async () => {
    renderRoadmap();
    await screen.findByText("통합 테스트");

    fireEvent.click(screen.getByRole("button", { name: /프로젝트 단계 추천/ }));
    expect(screen.getByRole("dialog", { name: "프로젝트 단계 추천" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("단계명 1"), { target: { value: "문제 정의" } });
    fireEvent.click(screen.getByRole("button", { name: "단계 행 추가" }));
    fireEvent.change(screen.getByLabelText("단계명 6"), { target: { value: "사용자 검증" } });
    fireEvent.click(screen.getByRole("button", { name: "선택 단계 생성" }));

    await waitFor(() => expect(createMilestone).toHaveBeenCalledTimes(6));
    expect(createMilestone).toHaveBeenNthCalledWith(1, 1, {
      title: "문제 정의",
      startDate: "2026-07-01",
      dueDate: "2026-07-06",
    });
    expect(createMilestone).toHaveBeenNthCalledWith(5, 1, {
      title: "결과물 및 발표 준비",
      startDate: "2026-07-25",
      dueDate: "2026-07-31",
    });
    expect(createMilestone).toHaveBeenNthCalledWith(6, 1, {
      title: "사용자 검증",
      startDate: "2026-07-01",
      dueDate: "2026-07-31",
    });
    expect(await screen.findByText(/프로젝트 단계 6개를 생성했습니다/)).toBeInTheDocument();
  });

  it("waits for the real project context after refresh instead of requesting project 1", async () => {
    mockUseAuth.mockReturnValue({
      currentProjectId: null,
      currentProject: null,
      projectContextReady: false,
    });
    const view = renderRoadmap();

    expect(await screen.findByText("로드맵을 불러오는 중...")).toBeInTheDocument();
    expect(fetchRoadmap).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue({
      currentProjectId: 20,
      currentProject: { projectId: 20, projectTitle: "실제 프로젝트", role: "팀장" },
      projectContextReady: true,
    });
    view.rerender(
      <MemoryRouter>
        <RoadmapView />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fetchRoadmap).toHaveBeenCalledWith(20));
    expect(fetchRoadmap).not.toHaveBeenCalledWith(1);
  });

  it("ignores a late response from the previously selected project", async () => {
    let resolveProject20!: (value: typeof response) => void;
    let resolveProject21!: (value: typeof response) => void;
    const project20 = new Promise<typeof response>((resolve) => { resolveProject20 = resolve; });
    const project21 = new Promise<typeof response>((resolve) => { resolveProject21 = resolve; });
    fetchRoadmap.mockImplementation((projectId: number) => projectId === 20 ? project20 : project21);
    mockUseAuth.mockReturnValue({
      currentProjectId: 20,
      currentProject: { projectId: 20, projectTitle: "이전 프로젝트", role: "팀장" },
      projectContextReady: true,
    });
    const view = renderRoadmap();
    await waitFor(() => expect(fetchRoadmap).toHaveBeenCalledWith(20));

    mockUseAuth.mockReturnValue({
      currentProjectId: 21,
      currentProject: { projectId: 21, projectTitle: "현재 프로젝트", role: "팀장" },
      projectContextReady: true,
    });
    view.rerender(
      <MemoryRouter>
        <RoadmapView />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetchRoadmap).toHaveBeenCalledWith(21));

    await act(async () => {
      resolveProject21({
        ...structuredClone(response),
        project: { ...response.project, id: "21", title: "현재 프로젝트" },
      });
    });
    expect(await screen.findByText(/현재 프로젝트/, { selector: ".text-\\[10px\\].text-muted-foreground" })).toBeInTheDocument();

    await act(async () => {
      resolveProject20({
        ...structuredClone(response),
        project: { ...response.project, id: "20", title: "이전 프로젝트" },
      });
    });

    expect(screen.queryByText(/이전 프로젝트/, { selector: ".text-\\[10px\\].text-muted-foreground" })).not.toBeInTheDocument();
    expect(screen.getByText(/현재 프로젝트/, { selector: ".text-\\[10px\\].text-muted-foreground" })).toBeInTheDocument();
  });
});

describe("RoadmapView project schedule guidance", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      currentProjectId: 1,
      currentProject: { projectId: 1, projectTitle: "WorkFlow AI", role: "팀장" },
      projectContextReady: true,
    });
  });

  it("warns about missing project dates and collapses unassigned tasks", async () => {
    vi.clearAllMocks();
    fetchRoadmap.mockResolvedValue({
      ...structuredClone(response),
      project: { ...response.project, startDate: null, deadline: null },
      milestones: [],
      unassignedTasks: [{
        id: "99", milestoneId: null, title: "Legacy task", category: "other", status: "todo",
        assigneeId: null, assigneeName: null, startDate: null, dueDate: "2025-12-28",
        priority: "medium", position: 0,
      }],
    });

    renderRoadmap();

    expect(await screen.findByText(/프로젝트 시작일과 종료일이 없어/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /새 단계/ })) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByText("Legacy task")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /단계 미지정/ }));
    expect(await screen.findByText("Legacy task")).toBeInTheDocument();
    expect(screen.getByText(/표시 범위 밖/)).toBeInTheDocument();
  });
});
