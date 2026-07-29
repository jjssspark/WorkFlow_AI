import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { __resetInsightConcurrencyStateForTests, useAiInsight } from "./useAiInsight";
import { apiFetch } from "../../../global/api/apiClient";

vi.mock("../../../global/api/apiClient", () => ({
  apiFetch: vi.fn(),
}));

describe("useAiInsight", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // activeInsightRequests/pendingInsightRequests는 모듈 레벨 전역 상태라, 이전
    // 테스트에서 resolve되지 않은 요청이 슬롯을 점유한 채로 넘어오면 다음 테스트가
    // 동시 실행 개수를 잘못 관찰한다.
    __resetInsightConcurrencyStateForTests();
  });

  it("does not ask until ready is true", () => {
    renderHook(() => useAiInsight(1, "질문", false));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("asks exactly once when ready becomes true, and reports the answer", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "추천 답변", sources: [] });

    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useAiInsight(1, "질문입니다", ready),
      { initialProps: { ready: false } }
    );

    expect(result.current.loading).toBe(false);
    rerender({ ready: true });

    await waitFor(() => expect(result.current.text).toBe("추천 답변"));
    expect(apiFetch).toHaveBeenCalledTimes(1);

    rerender({ ready: true });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
  });

  it("does not ask when projectId is null", () => {
    renderHook(() => useAiInsight(null, "질문", true));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("asks again with the new project context when the selected project changes", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ type: "answer", message: "첫 프로젝트 답변", sources: [] })
      .mockResolvedValueOnce({ type: "answer", message: "두 번째 프로젝트 답변", sources: [] });

    const { result, rerender } = renderHook(
      ({ projectId, prompt }: { projectId: number; prompt: string }) => useAiInsight(projectId, prompt, true),
      { initialProps: { projectId: 1, prompt: "첫 프로젝트 질문" } }
    );

    await waitFor(() => expect(result.current.text).toBe("첫 프로젝트 답변"));
    rerender({ projectId: 2, prompt: "두 번째 프로젝트 질문" });

    await waitFor(() => expect(result.current.text).toBe("두 번째 프로젝트 답변"));
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      body: expect.stringContaining("두 번째 프로젝트 질문"),
    }));
  });

  it("surfaces an error message when the query fails", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("일시적으로 답변을 생성할 수 없습니다"));

    const { result } = renderHook(() => useAiInsight(1, "질문", true));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.text).toBeNull();
  });

  it("caps concurrent auto-queries when many instances become ready at once", async () => {
    // BlockersPage처럼 useAiInsight를 쓰는 카드가 여러 개 동시에 렌더되는 상황을 흉내낸다.
    // apiFetch가 즉시 resolve되지 않게 해서, 동시에 실행 중인 호출 수가 상한을 넘는지 확인한다.
    let resolveCount = 0;
    const pendingResolvers: Array<() => void> = [];
    vi.mocked(apiFetch).mockImplementation(
      () =>
        new Promise(resolve => {
          pendingResolvers.push(() => {
            resolveCount += 1;
            resolve({ type: "answer", message: `답변 ${resolveCount}`, sources: [] });
          });
        })
    );

    const CARD_COUNT = 5;
    renderHook(() => {
      for (let i = 0; i < CARD_COUNT; i += 1) {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useAiInsight(1, `질문 ${i}`, true);
      }
    });

    // 동시 실행 상한(2)을 넘는 호출이 즉시 나가지 않아야 한다.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(apiFetch).not.toHaveBeenCalledTimes(3);

    // 앞선 요청이 끝나면 대기열에서 다음 요청이 순서대로 실행된다.
    pendingResolvers[0]();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));

    pendingResolvers[1]();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4));

    pendingResolvers[2]();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(5));

    pendingResolvers[3]();
    pendingResolvers[4]();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(5));
  });

  it("still asks when queued under StrictMode's double-invoked effects", async () => {
    // StrictMode(개발 모드)는 effect를 mount → cleanup → mount 순으로 두 번 실행한다.
    // 대기열에서 순서를 기다리던 요청이 첫 mount의 cleanup 때문에 영구히 누락되지 않고,
    // 두 번째 mount에서 다시 등록돼 정상적으로 질의가 나가는지 확인한다.
    let releaseFirst: (() => void) | null = null;
    const pendingResolvers: Array<() => void> = [];
    let resolveCount = 0;
    vi.mocked(apiFetch).mockImplementation(
      () =>
        new Promise(resolve => {
          const release = () => {
            resolveCount += 1;
            resolve({ type: "answer", message: `답변 ${resolveCount}`, sources: [] });
          };
          if (!releaseFirst) releaseFirst = release;
          else pendingResolvers.push(release);
        })
    );

    // 상한(2)을 채워 세 번째 인스턴스가 대기열로 밀리게 만든다.
    renderHook(() => useAiInsight(1, "채워두기 1", true));
    renderHook(() => useAiInsight(1, "채워두기 2", true));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));

    renderHook(
      ({ ready }: { ready: boolean }) => useAiInsight(1, "대기열 질문", ready),
      { initialProps: { ready: true }, wrapper: StrictMode }
    );

    // 대기열에서 아직 실행되지 않은 상태 - 앞선 두 요청이 끝나기 전까지 호출되면 안 된다.
    expect(apiFetch).toHaveBeenCalledTimes(2);

    releaseFirst!();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
    expect(apiFetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      body: expect.stringContaining("대기열 질문"),
    }));
  });

  it("releases the concurrency slot and drains the queue even when a request fails", async () => {
    // ask가 실패(reject)해도 슬롯이 해제되지 않으면 대기열 전체가 멈춘다.
    // useRagQuery.ask는 항상 async 함수라 실제로 동기 예외를 던지지는 않지만, 실패
    // 케이스에서도 finally(releaseInsightSlot)가 반드시 실행돼야 한다는 요구사항은 같다.
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("첫 요청 실패"));

    renderHook(() => useAiInsight(1, "실패하는 질문", true));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

    // 슬롯이 해제되지 않았다면 이 두 번째 요청이 대기열에 갇혀 apiFetch가 다시 불리지 않는다.
    vi.mocked(apiFetch).mockResolvedValue({ type: "answer", message: "정상 답변", sources: [] });
    const { result } = renderHook(() => useAiInsight(1, "그다음 질문", true));

    await waitFor(() => expect(result.current.text).toBe("정상 답변"));
  });
});
