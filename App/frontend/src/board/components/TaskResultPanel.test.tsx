import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TaskResultPanel } from "./TaskResultPanel";
import {
  fetchTaskResult, saveTaskResult, addTaskResultLink, deleteTaskResultLink,
  uploadTaskResultFile, deleteTaskResultFile, getTaskResultFileUrl,
} from "../libs/utils/taskResultApi";
import type { Task } from "../libs/types/task";

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({ currentProjectId: 1, user: { id: 5, name: "박지수", email: "member3@workflow.ai" } }),
}));

vi.mock("../libs/utils/taskResultApi", () => ({
  fetchTaskResult: vi.fn(),
  saveTaskResult: vi.fn(),
  addTaskResultLink: vi.fn(),
  deleteTaskResultLink: vi.fn(),
  uploadTaskResultFile: vi.fn(),
  deleteTaskResultFile: vi.fn(),
  getTaskResultFileUrl: vi.fn(),
}));

const emptyResult = { content: "", updatedAt: null, links: [], files: [] };

// mockUseAuth의 user.id(5)와 담당자를 일치시켜, 기본적으로 "본인 업무를 보는 담당자" 시나리오로 렌더링한다.
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TF-01", title: "테스트 업무", status: "todo", priority: "medium",
    assignee: "5", dueDate: "2026-07-20", labels: [], category: "backend", position: 0, pendingApproval: false, startDate: "", extraFields: {},
    ...overrides,
  };
}

function renderPanel(onShowToast = vi.fn(), taskOverrides: Partial<Task> = {}) {
  render(<TaskResultPanel task={makeTask(taskOverrides)} onClose={vi.fn()} onShowToast={onShowToast} />);
  return { onShowToast };
}

beforeEach(() => {
  vi.mocked(fetchTaskResult).mockReset().mockResolvedValue(emptyResult);
  vi.mocked(saveTaskResult).mockReset();
  vi.mocked(addTaskResultLink).mockReset();
  vi.mocked(deleteTaskResultLink).mockReset();
  vi.mocked(uploadTaskResultFile).mockReset();
  vi.mocked(deleteTaskResultFile).mockReset();
  vi.mocked(getTaskResultFileUrl).mockReset();
  window.open = vi.fn();
});

describe("TaskResultPanel", () => {
  it("마운트 시 저장된 내용을 불러와 표시한다", async () => {
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "이전에 작성한 내용", updatedAt: "2026-07-21T00:00:00",
      links: [{ id: "1", url: "https://github.com/x/y", title: "PR #1" }],
      files: [{ id: "9", fileName: "meeting_result.pdf", size: 2048, contentType: "application/pdf" }],
    });
    renderPanel();

    expect(await screen.findByDisplayValue("이전에 작성한 내용")).toBeInTheDocument();
    expect(screen.getByText("PR #1")).toBeInTheDocument();
    expect(screen.getByText("meeting_result.pdf")).toBeInTheDocument();
    expect(screen.getByText("수정")).toBeInTheDocument();
    expect(fetchTaskResult).toHaveBeenCalledWith("TF-01", 1);
  });

  it("불러오기 실패 시 에러 메시지를 보여준다", async () => {
    vi.mocked(fetchTaskResult).mockRejectedValue(new Error("network"));
    renderPanel();
    expect(await screen.findByText("작업 내용을 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("생성 버튼 클릭 시 저장 API를 호출하고 토스트를 띄우며 '수정'으로 바뀐다", async () => {
    vi.mocked(saveTaskResult).mockResolvedValue({ content: "새 작업 내용", updatedAt: "2026-07-21T00:00:00", links: [], files: [] });
    const { onShowToast } = renderPanel();
    await screen.findByPlaceholderText("이번 작업에서 무엇을 했는지 작성해주세요.");

    await userEvent.type(screen.getByPlaceholderText("이번 작업에서 무엇을 했는지 작성해주세요."), "새 작업 내용");
    await userEvent.click(screen.getByText("생성"));

    await waitFor(() => expect(saveTaskResult).toHaveBeenCalledWith("TF-01", "새 작업 내용", 1));
    expect(onShowToast).toHaveBeenCalledWith("작업 내용을 저장했습니다.");
    expect(await screen.findByText("수정")).toBeInTheDocument();
  });

  it("담당자도 팀장도 아니면 작성/업로드/링크추가 컨트롤이 아예 보이지 않는다", async () => {
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "이미 작성된 내용", updatedAt: "2026-07-21T00:00:00",
      links: [{ id: "1", url: "https://github.com/x/y", title: "PR #1" }],
      files: [{ id: "9", fileName: "meeting_result.pdf", size: 2048, contentType: "application/pdf" }],
    });
    renderPanel(vi.fn(), { assignee: "999" });

    const textarea = await screen.findByDisplayValue("이미 작성된 내용");
    expect(textarea).toHaveAttribute("readonly");
    expect(screen.queryByText("생성")).not.toBeInTheDocument();
    expect(screen.queryByText("초기화")).not.toBeInTheDocument();
    expect(screen.queryByText("파일 업로드")).not.toBeInTheDocument();
    expect(screen.queryByText("링크 추가")).not.toBeInTheDocument();
    // 기존 파일/링크는 그대로 보이되, 삭제 버튼만 없다(row에 열기 버튼 하나만 남음).
    const fileRow = (await screen.findByText("meeting_result.pdf")).closest("div.group") as HTMLElement;
    expect(fileRow.querySelectorAll("button")).toHaveLength(1);
    const linkRow = (await screen.findByText("PR #1")).closest("div.group") as HTMLElement;
    expect(linkRow.querySelectorAll("button")).toHaveLength(1);
  });

  it("초기화 버튼은 서버를 호출하지 않고 입력창만 비운다", async () => {
    vi.mocked(fetchTaskResult).mockResolvedValue({ content: "기존 내용", updatedAt: "2026-07-21T00:00:00", links: [], files: [] });
    renderPanel();
    const textarea = await screen.findByDisplayValue("기존 내용");

    await userEvent.click(screen.getByText("초기화"));
    expect(textarea).toHaveValue("");
    expect(saveTaskResult).not.toHaveBeenCalled();
  });

  it("파일을 업로드하면 API를 호출하고 목록에 표시된다", async () => {
    vi.mocked(uploadTaskResultFile).mockResolvedValue({ id: "10", fileName: "schema_documentation.docx", size: 2048, contentType: "application/octet-stream" });
    renderPanel();
    await screen.findByPlaceholderText("이번 작업에서 무엇을 했는지 작성해주세요.");

    const file = new File(["a".repeat(2048)], "schema_documentation.docx", { type: "application/octet-stream" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(await screen.findByText("schema_documentation.docx")).toBeInTheDocument();
    expect(uploadTaskResultFile).toHaveBeenCalledWith("TF-01", file, 1);
  });

  it("100MB를 초과하는 파일은 업로드를 시도하지 않고 토스트만 띄운다", async () => {
    const { onShowToast } = renderPanel();
    await screen.findByPlaceholderText("이번 작업에서 무엇을 했는지 작성해주세요.");

    const bigFile = new File(["a"], "big.zip", { type: "application/zip" });
    Object.defineProperty(bigFile, "size", { value: 100 * 1024 * 1024 + 1 });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, bigFile);

    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith("'big.zip'은(는) 100MB를 초과해서 업로드할 수 없습니다."));
    expect(uploadTaskResultFile).not.toHaveBeenCalled();
  });

  it("파일 클릭 시 다운로드 URL을 받아서 새 탭으로 연다", async () => {
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "", updatedAt: null, links: [],
      files: [{ id: "9", fileName: "meeting_result.pdf", size: 2048, contentType: "application/pdf" }],
    });
    vi.mocked(getTaskResultFileUrl).mockResolvedValue("https://signed.example.com/meeting_result.pdf");
    renderPanel();

    await userEvent.click(await screen.findByText("meeting_result.pdf"));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://signed.example.com/meeting_result.pdf", "_blank", "noopener,noreferrer"));
  });

  it("파일 삭제 시 API를 호출하고 목록에서 제거된다", async () => {
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "", updatedAt: null, links: [],
      files: [{ id: "9", fileName: "meeting_result.pdf", size: 2048, contentType: "application/pdf" }],
    });
    renderPanel();
    const row = (await screen.findByText("meeting_result.pdf")).closest("div.group") as HTMLElement;
    const deleteBtn = row.querySelectorAll("button")[1] as HTMLElement;
    await userEvent.click(deleteBtn);

    await waitFor(() => expect(deleteTaskResultFile).toHaveBeenCalledWith("TF-01", "9", 1));
    expect(screen.queryByText("meeting_result.pdf")).not.toBeInTheDocument();
  });

  it("링크를 추가하면 API를 호출하고 목록에 표시된다", async () => {
    vi.mocked(addTaskResultLink).mockResolvedValue({ id: "2", url: "https://github.com/teamflow-ai/backend/pull/42", title: "PR #42" });
    renderPanel();
    await userEvent.click(await screen.findByText("링크 추가"));
    await userEvent.type(screen.getByPlaceholderText("https://..."), "https://github.com/teamflow-ai/backend/pull/42");
    await userEvent.type(screen.getByPlaceholderText("제목 (선택)"), "PR #42");
    await userEvent.click(screen.getByText("추가"));

    expect(await screen.findByText("PR #42")).toBeInTheDocument();
    expect(addTaskResultLink).toHaveBeenCalledWith("TF-01", "https://github.com/teamflow-ai/backend/pull/42", "PR #42", 1);
  });

  it("링크 삭제 시 API를 호출하고 목록에서 제거된다", async () => {
    vi.mocked(fetchTaskResult).mockResolvedValue({
      content: "", updatedAt: null, files: [],
      links: [{ id: "2", url: "https://github.com/x/y", title: "PR #42" }],
    });
    renderPanel();
    const row = (await screen.findByText("PR #42")).closest("div.group") as HTMLElement;
    const deleteBtn = row.querySelectorAll("button")[1] as HTMLElement;
    await userEvent.click(deleteBtn);

    await waitFor(() => expect(deleteTaskResultLink).toHaveBeenCalledWith("TF-01", "2", 1));
    expect(screen.queryByText("PR #42")).not.toBeInTheDocument();
  });

  it("닫기 버튼 클릭 시 onClose를 호출한다", async () => {
    const onClose = vi.fn();
    render(<TaskResultPanel task={makeTask()} onClose={onClose} onShowToast={vi.fn()} />);
    await userEvent.click(await screen.findByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
