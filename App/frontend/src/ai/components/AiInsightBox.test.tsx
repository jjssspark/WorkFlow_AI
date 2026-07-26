import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AiInsightBox } from "./AiInsightBox";
import { apiFetch } from "../../global/api/apiClient";
import { OPEN_AI_ASSISTANT_EVENT } from "../libs/utils/openAIAssistant";

vi.mock("../../global/api/apiClient", () => ({
  apiFetch: vi.fn(),
}));

describe("AiInsightBox", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the fallback text while the AI answer is loading, then the answer once it resolves", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "블로커부터 처리하세요", sources: [] });

    render(<AiInsightBox projectId={1} prompt="질문" ready fallbackText="폴백 문구" />);

    await waitFor(() => expect(screen.getByText("블로커부터 처리하세요")).toBeInTheDocument());
  });

  it("shows the fallback text when the AI query fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("실패"));

    render(<AiInsightBox projectId={1} prompt="질문" ready fallbackText="폴백 문구" />);

    await waitFor(() => expect(screen.getByText("폴백 문구")).toBeInTheDocument());
  });

  it("applies formatAnswer to wrap the raw LLM answer", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "코드 리뷰를 먼저 진행하세요", sources: [] });

    render(
      <AiInsightBox
        projectId={1}
        prompt="질문"
        ready
        fallbackText="폴백 문구"
        formatAnswer={answer => `김민준님, ${answer}`}
      />
    );

    await waitFor(() => expect(screen.getByText("김민준님, 코드 리뷰를 먼저 진행하세요")).toBeInTheDocument());
  });

  it("dispatches the open-AI-assistant event with the same prompt when the button is clicked", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "답변", sources: [] });
    const handler = vi.fn();
    window.addEventListener(OPEN_AI_ASSISTANT_EVENT, handler);

    render(<AiInsightBox projectId={1} prompt="블로커를 점검해줘" ready fallbackText="폴백" actionLabel="자세히" />);
    await waitFor(() => expect(screen.getByText("답변")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "자세히" }));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{ question?: string }>;
    expect(event.detail.question).toBe("블로커를 점검해줘");

    window.removeEventListener(OPEN_AI_ASSISTANT_EVENT, handler);
  });

  it("renders the banner variant with the given action label", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "답변", sources: [] });

    render(<AiInsightBox projectId={1} prompt="질문" ready fallbackText="폴백" variant="banner" actionLabel="자세히" />);

    expect(screen.getByRole("button", { name: "자세히" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("답변")).toBeInTheDocument());
  });
});
