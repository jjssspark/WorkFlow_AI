import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeMeeting } from "../libs/utils/meetingAiApi";
import { MeetingUploadModal } from "./MeetingUploadModal";

vi.mock("../libs/utils/meetingAiApi", () => ({
  analyzeMeeting: vi.fn(),
}));

const projectMembers = [
  { userId: 1, name: "김민준", email: "leader@test.com", role: "팀장" as const },
  { userId: 2, name: "이서연", email: "member@test.com", role: "팀원" as const },
];

const openDocumentForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /문서 업로드/ }));
  await user.click(screen.getByRole("button", { name: "다음" }));
};

describe("MeetingUploadModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("업로드 요청이 성공하기 전에는 완료 콜백을 호출하지 않고, 접수 후에만 회의 페이지 전환 정보를 넘긴다", async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    let resolveAnalysis!: (value: Awaited<ReturnType<typeof analyzeMeeting>>) => void;
    vi.mocked(analyzeMeeting).mockReturnValue(new Promise(resolve => { resolveAnalysis = resolve; }));

    const { container } = render(
      <MeetingUploadModal
        projectId="7"
        projectMembers={projectMembers}
        onClose={vi.fn()}
        onUploaded={onUploaded}
      />
    );

    await openDocumentForm(user);
    const file = new File(["회의 내용"], "7차 정기회의.txt", { type: "text/plain" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, file);
    await user.click(screen.getByRole("button", { name: /김민준/ }));
    await user.click(screen.getByRole("button", { name: "업로드 및 AI 분석 시작" }));

    expect(analyzeMeeting).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "7",
      file,
      title: "7차 정기회의",
      sourceType: "document",
      participants: ["김민준"],
      attendeeIds: [1],
    }));
    expect(onUploaded).not.toHaveBeenCalled();

    resolveAnalysis({
      meetingId: "meeting-77",
      projectId: "7",
      status: "PROCESSING",
      sourceType: "document",
      fileName: file.name,
      analysisSource: null,
      analysis: null,
      errorMessage: null,
      attendees: [],
      transcript: null,
    });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(onUploaded).toHaveBeenCalledWith(
      "meeting-77",
      "7차 정기회의",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it("참석자를 선택하지 않으면 업로드 요청을 보내지 않는다", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MeetingUploadModal
        projectId="7"
        projectMembers={projectMembers}
        onClose={vi.fn()}
        onUploaded={vi.fn()}
      />
    );

    await openDocumentForm(user);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(input!, new File(["회의 내용"], "회의록.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "업로드 및 AI 분석 시작" }));

    expect(await screen.findByText("참석자를 1명 이상 선택해주세요.")).toBeInTheDocument();
    expect(analyzeMeeting).not.toHaveBeenCalled();
  });

  it("문서 업로드에서는 회의록 양식을 내려받을 수 있다", async () => {
    const user = userEvent.setup();
    render(
      <MeetingUploadModal
        projectId="7"
        projectMembers={projectMembers}
        onClose={vi.fn()}
        onUploaded={vi.fn()}
      />
    );

    await openDocumentForm(user);

    const templateLink = screen.getByRole("link", { name: /회의록 양식 다운로드/ });
    expect(templateLink).toHaveAttribute("href", "/templates/meeting-minutes-template.docx");
    expect(templateLink).toHaveAttribute("download", "회의록_양식.docx");
  });

  it("음성 업로드에는 양식 다운로드를 노출하지 않는다", async () => {
    const user = userEvent.setup();
    render(
      <MeetingUploadModal
        projectId="7"
        projectMembers={projectMembers}
        onClose={vi.fn()}
        onUploaded={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /음성파일 업로드/ }));
    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.queryByRole("link", { name: /회의록 양식 다운로드/ })).not.toBeInTheDocument();
  });
});
