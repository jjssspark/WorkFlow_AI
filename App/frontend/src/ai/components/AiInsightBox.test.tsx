import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiInsightBox } from "./AiInsightBox";

const { mockUseAiInsight, mockOpenAIAssistant } = vi.hoisted(() => ({
  mockUseAiInsight: vi.fn(),
  mockOpenAIAssistant: vi.fn(),
}));

vi.mock("../libs/hooks/useAiInsight", () => ({
  useAiInsight: mockUseAiInsight,
}));

vi.mock("../libs/utils/openAIAssistant", () => ({
  openAIAssistant: mockOpenAIAssistant,
}));

describe("AiInsightBox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAiInsight.mockReturnValue({ text: null, loading: false, error: null });
  });

  it("shows the LLM loading state and passes the current project prompt to the hook", () => {
    mockUseAiInsight.mockReturnValue({ text: null, loading: true, error: null });

    render(<AiInsightBox projectId={7} prompt="지연 업무를 분석해줘" ready />);

    expect(screen.getByText("AI가 답변을 준비하고 있습니다...")).toBeInTheDocument();
    expect(mockUseAiInsight).toHaveBeenCalledWith(7, "지연 업무를 분석해줘", true);
  });

  it("formats and displays a successful LLM answer", () => {
    mockUseAiInsight.mockReturnValue({ text: "코드 리뷰를 먼저 진행하세요", loading: false, error: null });

    render(
      <AiInsightBox
        projectId={1}
        prompt="질문"
        ready
        formatAnswer={answer => `김민준님, ${answer}`}
      />
    );

    expect(screen.getByText("김민준님, 코드 리뷰를 먼저 진행하세요")).toBeInTheDocument();
  });

  it("shows the fallback text when the LLM query fails", () => {
    mockUseAiInsight.mockReturnValue({ text: null, loading: false, error: "일시적인 오류" });

    render(<AiInsightBox projectId={1} prompt="질문" ready errorText="분석 결과를 불러오지 못했습니다." />);

    expect(screen.getByText("분석 결과를 불러오지 못했습니다.")).toBeInTheDocument();
  });

  it("opens the assistant with the original prompt before an answer is available", async () => {
    mockUseAiInsight.mockReturnValue({ text: null, loading: true, error: null });
    render(<AiInsightBox projectId={1} prompt="블로커를 점검해줘" ready actionLabel="자세히" />);

    await userEvent.click(screen.getByRole("button", { name: "자세히" }));

    expect(mockOpenAIAssistant).toHaveBeenCalledWith("블로커를 점검해줘");
  });

  it("opens a follow-up question with the displayed answer and custom title", async () => {
    mockUseAiInsight.mockReturnValue({ text: "배포 일정을 먼저 확인하세요", loading: false, error: null });
    render(
      <AiInsightBox
        projectId={1}
        prompt="최근 활동을 분석해줘"
        ready
        title="AI 주간 활동 요약"
        actionLabel="자세히 보기"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "자세히 보기" }));

    expect(mockOpenAIAssistant).toHaveBeenCalledWith(
      '방금 "AI 주간 활동 요약"에서 보여준 다음 내용을 더 자세히 설명해줘: "배포 일정을 먼저 확인하세요"'
    );
  });

  it("renders the banner variant", () => {
    mockUseAiInsight.mockReturnValue({ text: "답변", loading: false, error: null });

    render(<AiInsightBox projectId={1} prompt="질문" ready variant="banner" actionLabel="자세히" />);

    expect(screen.getByText("AI 추천 액션")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자세히" })).toBeInTheDocument();
  });
});
