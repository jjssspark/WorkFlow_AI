import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as meetingAiApi from "../libs/utils/meetingAiApi";
import { MeetingEditPanel } from "./MeetingEditPanel";

describe("MeetingEditPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("저장 버튼 클릭 시 triggerAnalysis=false로 버전을 생성한다", async () => {
    const spy = vi.spyOn(meetingAiApi, "createMeetingVersion").mockResolvedValue({ meetingId: "6", status: "SAVED" });
    const onSaved = vi.fn();
    render(<MeetingEditPanel projectId="demo-project" meetingId="5" initialTranscript="원문" onSaved={onSaved} onAnalyzed={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "수정된 본문" } });
    fireEvent.click(screen.getByText("저장"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith("demo-project", "5", "수정된 본문", false);
  });

  it("분석하기 버튼 클릭 시 triggerAnalysis=true로 버전을 생성하고, 분석 완료까지 기다린 뒤 onAnalyzed를 호출한다", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(meetingAiApi, "createMeetingVersion").mockResolvedValue({ meetingId: "6", status: "PROCESSING" });
    vi.spyOn(meetingAiApi, "fetchMeeting").mockResolvedValue({
      meetingId: "6", projectId: "demo-project", status: "COMPLETED", sourceType: "document",
      fileName: null, analysisSource: null, analysis: null, errorMessage: null, attendees: [], transcript: null,
    });
    const onAnalyzed = vi.fn();
    render(<MeetingEditPanel projectId="demo-project" meetingId="5" initialTranscript="원문" onSaved={vi.fn()} onAnalyzed={onAnalyzed} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "수정된 본문" } });
    fireEvent.click(screen.getByText("분석하기"));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onAnalyzed).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("demo-project", "5", "수정된 본문", true);
    vi.useRealTimers();
  });

  it("재분석이 FAILED로 끝나면 백엔드 에러 메시지를 노출하고 onAnalyzed를 호출하지 않는다", async () => {
    vi.useFakeTimers();
    vi.spyOn(meetingAiApi, "createMeetingVersion").mockResolvedValue({ meetingId: "6", status: "PROCESSING" });
    vi.spyOn(meetingAiApi, "fetchMeeting").mockResolvedValue({
      meetingId: "6", projectId: "demo-project", status: "FAILED", sourceType: "document",
      fileName: null, analysisSource: null, analysis: null, errorMessage: "AI 분석 서버 응답 시간 초과", attendees: [], transcript: null,
    });
    const onAnalyzed = vi.fn();
    render(<MeetingEditPanel projectId="demo-project" meetingId="5" initialTranscript="원문" onSaved={vi.fn()} onAnalyzed={onAnalyzed} />);

    fireEvent.click(screen.getByText("분석하기"));

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("AI 분석 서버 응답 시간 초과")).toBeInTheDocument();
    expect(onAnalyzed).not.toHaveBeenCalled();
  });

  it("저장 실패 시 실제 에러 메시지를 노출하고 onSaved를 호출하지 않는다", async () => {
    vi.spyOn(meetingAiApi, "createMeetingVersion").mockRejectedValue(new Error("network down"));
    const onSaved = vi.fn();
    render(<MeetingEditPanel projectId="demo-project" meetingId="5" initialTranscript="원문" onSaved={onSaved} onAnalyzed={vi.fn()} />);

    fireEvent.click(screen.getByText("저장"));

    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("분석하기 요청 자체가 실패하면 실제 에러 메시지를 노출하고 onAnalyzed를 호출하지 않는다", async () => {
    vi.spyOn(meetingAiApi, "createMeetingVersion").mockRejectedValue(new Error("network down"));
    const onAnalyzed = vi.fn();
    render(<MeetingEditPanel projectId="demo-project" meetingId="5" initialTranscript="원문" onSaved={vi.fn()} onAnalyzed={onAnalyzed} />);

    fireEvent.click(screen.getByText("분석하기"));

    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(onAnalyzed).not.toHaveBeenCalled();
  });
});
