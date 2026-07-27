import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIAssistant } from "./AIAssistant";
import { apiFetch } from "../../global/api/apiClient";

let mockCurrentProjectId: number | null = 1;

vi.mock("../../global/hooks/useAuth", () => ({
  useAuth: () => ({ currentProjectId: mockCurrentProjectId }),
}));

vi.mock("../../global/api/apiClient", () => ({
  apiFetch: vi.fn(),
}));

describe("AIAssistant", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCurrentProjectId = 1;
    sessionStorage.clear();
  });

  it("renders initial assistant greeting", () => {
    render(<AIAssistant onClose={() => {}} />);
    expect(screen.getByText(/WorkFlow AI 어시스턴트/)).toBeInTheDocument();
  });

  it("shows loading indicator then renders answer with source badge", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      type: "answer",
      message: "실제 RAG 답변",
      sources: [{ source_type: "meeting", source_id: 3, content_snippet: "요약", similarity: 0.8 }],
    });

    render(<AIAssistant onClose={() => {}} />);
    const textbox = screen.getByPlaceholderText("프로젝트에 대해 무엇이든 물어보세요...");
    await userEvent.type(textbox, "오늘 할 일 알려줘");
    await userEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => expect(screen.getByText("실제 RAG 답변")).toBeInTheDocument());
    expect(screen.getByText(/출처: 회의록 #3/)).toBeInTheDocument();
  });

  it("shows API error message", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("로그인이 필요합니다."));

    render(<AIAssistant onClose={() => {}} />);
    const textbox = screen.getByPlaceholderText("프로젝트에 대해 무엇이든 물어보세요...");
    await userEvent.type(textbox, "질문{enter}");

    await waitFor(() => expect(screen.getByText("로그인이 필요합니다.")).toBeInTheDocument());
  });

  it("shows an empty project message instead of calling RAG when no project is selected", async () => {
    mockCurrentProjectId = null;

    render(<AIAssistant onClose={() => {}} />);
    const textbox = screen.getByPlaceholderText("프로젝트에 대해 무엇이든 물어보세요...");
    await userEvent.type(textbox, "회의록 요약해줘");
    await userEvent.click(screen.getByRole("button", { name: "전송" }));

    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText("아직 연결된 프로젝트가 없습니다. 프로젝트를 만들고 회의록을 업로드한 뒤 다시 질문해주세요.")).toBeInTheDocument();
  });

  it("automatically sends a pending dashboard question exactly once", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "추천 답변", sources: [] });

    const { rerender } = render(
      <AIAssistant
        onClose={() => {}}
        pendingQuestion={{ question: "블로커 해결 방법을 추천해줘", requestId: 101 }}
      />
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText("블로커 해결 방법을 추천해줘")).toBeInTheDocument();

    rerender(
      <AIAssistant
        onClose={() => {}}
        pendingQuestion={{ question: "블로커 해결 방법을 추천해줘", requestId: 101 }}
      />
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("restores a saved session whose answer cites an action_item source", async () => {
    // action_item 출처가 타입 가드에 걸리면 isChatMsg -> isChatSession이 연쇄 실패해
    // 저장된 대화가 통째로 폐기된다. 멀티턴이 참조할 직전 답변이 사라지는 경로다.
    sessionStorage.setItem(
      "ai-assistant-chat-session:anon:1",
      JSON.stringify({
        savedAt: Date.now(),
        messages: [
          { role: "user", content: "내 업무가 뭐야?" },
          {
            role: "assistant",
            content: "로그인 API 구현 업무가 있습니다",
            sources: [
              { sourceType: "action_item", sourceId: 7, contentSnippet: "로그인 API", similarity: 0.9 },
            ],
          },
        ],
      })
    );

    render(<AIAssistant onClose={() => {}} />);

    expect(screen.getByText("로그인 API 구현 업무가 있습니다")).toBeInTheDocument();
    expect(screen.getByText(/출처: 액션아이템 #7/)).toBeInTheDocument();
  });

  describe("답변 생성 중 창을 닫았을 때", () => {
    function deferredAnswer() {
      let resolve!: (value: unknown) => void;
      const pending = new Promise(r => { resolve = r; });
      vi.mocked(apiFetch).mockReturnValue(pending as Promise<never>);
      return () => resolve({ type: "answer", message: "닫은 뒤 도착한 답변", sources: [] });
    }

    async function askThenClose(props: Partial<Parameters<typeof AIAssistant>[0]> = {}) {
      const deliver = deferredAnswer();
      const view = render(<AIAssistant onClose={() => {}} isOpen {...props} />);
      await userEvent.type(screen.getByPlaceholderText("프로젝트에 대해 무엇이든 물어보세요..."), "질문{enter}");
      view.rerender(<AIAssistant onClose={() => {}} isOpen={false} {...props} />);
      return { view, deliver };
    }

    it("keeps generating the answer instead of aborting the request", async () => {
      // 닫을 때 요청을 끊으면 다시 열어도 질문만 남고 답변이 영영 오지 않는다.
      const { view, deliver } = await askThenClose();

      deliver();
      view.rerender(<AIAssistant onClose={() => {}} isOpen />);

      await waitFor(() => expect(screen.getByText("닫은 뒤 도착한 답변")).toBeInTheDocument());
    });

    it("hides the panel without unmounting it", async () => {
      const { view } = await askThenClose();

      // 언마운트하면 진행 중인 요청과 대화 상태가 함께 사라진다. 숨기기만 해야 한다.
      const panel = view.container.querySelector("div");
      expect(panel).toHaveStyle({ display: "none" });
      expect(panel).toHaveAttribute("aria-hidden", "true");
    });

    it("reports the answer that landed while the panel was closed", async () => {
      const onAnswerWhileClosed = vi.fn();
      const { deliver } = await askThenClose({ onAnswerWhileClosed });

      deliver();

      await waitFor(() => expect(onAnswerWhileClosed).toHaveBeenCalledTimes(1));
    });

    it("stays quiet when the answer lands while the panel is open", async () => {
      const onAnswerWhileClosed = vi.fn();
      const deliver = deferredAnswer();
      render(<AIAssistant onClose={() => {}} isOpen onAnswerWhileClosed={onAnswerWhileClosed} />);
      await userEvent.type(screen.getByPlaceholderText("프로젝트에 대해 무엇이든 물어보세요..."), "질문{enter}");

      deliver();

      await waitFor(() => expect(screen.getByText("닫은 뒤 도착한 답변")).toBeInTheDocument());
      expect(onAnswerWhileClosed).not.toHaveBeenCalled();
    });
  });
});
