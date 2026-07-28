// 대시보드 AI 재분석(지연 위험도)/재계산(업무 편중) 요청은 Redis Queue에 적재되어 백그라운드에서
// 처리된다. 완료 여부를 알 수 있는 SSE 트리거가 아직 화면에 연결되어 있지 않으므로,
// meetings/MeetingEditPanel.tsx의 waitForAnalysisCompletion과 동일하게 짧은 주기로 상태를 폴링한다.
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60; // 2초 * 60회 = 최대 2분 대기

export async function pollDashboardAiJobUntilDone(
  checkStatus: () => Promise<{ status: "PROCESSING" | "DONE" }>
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    const result = await checkStatus();
    if (result.status === "DONE") return;
  }
  throw new Error("분석 시간이 초과되었습니다. 잠시 후 다시 확인해주세요.");
}
