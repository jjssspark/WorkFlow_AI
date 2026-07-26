import { useEffect, useRef } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDashboardDueDate, normalizeTaskStatus } from "../libs/utils/dashboardTaskUtils";
import type { DashboardTaskDto } from "../libs/types/dashboard";

function EmptyState({ children }: { children: string }) {
  return <div className="w-full h-full flex items-center justify-center py-8 text-center text-xs text-muted-foreground">{children}</div>;
}

export interface FrequencyPoint {
  dateKey: string;
  label: string;
  전체: number;
  완료: number;
  dailyDoneCount: number;
}

export const FREQUENCY_POINT_WIDTH = 48;
export const FREQUENCY_WINDOW_DAYS = 7;

export const CHART_MARGIN_TOP = 20;
export const CHART_MARGIN_BOTTOM = 20;
export const Y_TICK_SEGMENTS = 4;

/** recharts YAxis 대신 쓰는 순수 CSS 고정축용 눈금 값 — 차트의 margin.top/bottom과 정확히 같은
 * 픽셀 기준으로 겹쳐 그리므로, 별도 recharts 축 인스턴스를 동기화할 필요가 없다. */
export function buildYTicks(max: number, segments: number): number[] {
  const ticks: number[] = [];
  for (let i = segments; i >= 0; i--) {
    ticks.push(Math.round((max * i) / segments));
  }
  return ticks;
}

export function dateKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

/** '업무가 완료 처리(status=done)된 날짜'만을 x축으로 삼아
 * 프로젝트 시작일~(마감일 또는 오늘) 범위의 누적 완료 업무량을 계산한다.
 * 오늘 완료 처리가 없었어도 차트가 항상 "오늘"까지 이어지도록 마지막 포인트로 오늘을 포함시킨다.
 * 완료일은 별도 이력이 없어 updatedAt을 완료 시점 근사로 쓴다 — 이 코드베이스 전반에서
 * 이미 쓰는 근사(daysSince 등)와 동일한 방식이다. */
export function buildFrequencyChart(
  tasks: DashboardTaskDto[],
  projectStart: string | null,
  projectDeadline: string | null
): FrequencyPoint[] {
  if (!projectStart) return [];
  const rangeStart = dateKeyOf(projectStart);
  const rangeEnd = projectDeadline ? dateKeyOf(projectDeadline) : dateKeyOf(new Date().toISOString());
  const todayKey = dateKeyOf(new Date().toISOString());

  const changeDates = new Set<string>();
  tasks.forEach(task => {
    if (normalizeTaskStatus(task.status) === "done" && task.updatedAt) changeDates.add(dateKeyOf(task.updatedAt));
  });
  if (todayKey >= rangeStart && todayKey <= rangeEnd) changeDates.add(todayKey);

  const sortedDates = Array.from(changeDates)
    .filter(dateKey => dateKey >= rangeStart && dateKey <= rangeEnd)
    .sort();

  let previousDone = 0;
  const points = sortedDates.map(dateKey => {
    const total = tasks.filter(task => task.createdAt && dateKeyOf(task.createdAt) <= dateKey).length;
    const done = tasks.filter(
      task => normalizeTaskStatus(task.status) === "done" && task.updatedAt && dateKeyOf(task.updatedAt) <= dateKey
    ).length;
    const dailyDoneCount = done - previousDone;
    previousDone = done;
    return { dateKey, label: formatDashboardDueDate(dateKey), 전체: total, 완료: done, dailyDoneCount };
  });

  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint.dateKey === todayKey) lastPoint.label = "오늘";
  return points;
}

function FrequencyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: FrequencyPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg bg-white shadow-lg border border-border px-3 py-2 text-[11px] space-y-0.5">
      <div className="font-semibold text-foreground">{point.label}</div>
      <div className="text-muted-foreground">전체 업무량: <span className="font-medium text-foreground">{point.전체}개</span></div>
      <div className="text-muted-foreground">일일 진행량: <span className="font-medium text-foreground">{point.dailyDoneCount}개</span></div>
    </div>
  );
}

/** '전체 진행률' 카드(대시보드)와 '계획 대비 실제 진행률' 카드(전체 진행률 페이지)가 함께 쓰는
 * 완료 업무 누적 빈도 그래프 — 단일 선 + 그라데이션 영역, 7일 스크롤 윈도우. */
export function ProgressFrequencyChart({
  tasks,
  projectStart,
  projectDeadline,
  totalTasks,
  loading,
}: {
  tasks: DashboardTaskDto[];
  projectStart: string | null;
  projectDeadline: string | null;
  totalTasks: number;
  loading: boolean;
}) {
  const frequencyChart = buildFrequencyChart(tasks, projectStart, projectDeadline);
  const frequencyYMax = Math.max(totalTasks, 1);
  // 실제 데이터 포인트 수가 기본 스크롤 윈도우(7개)보다 적으면, 빈 스크롤 여백 없이 카드 폭 전체를 채운다.
  // (시작일~오늘 일수 기준으로 판단하면 활동이 뜸한 날짜가 껴 있을 때 포인트 수가 7 미만인데도
  //  스크롤 모드로 빠져 최소폭(7칸) 강제로 인해 여백이 남는 문제가 있었다.)
  const frequencyFillsFullWidth = frequencyChart.length < FREQUENCY_WINDOW_DAYS;
  const frequencyScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 윈도우 시작값=오늘로부터 7일 전 — 로드/데이터 변경 시 항상 최신(가장 오른쪽) 구간으로 스크롤한다.
    frequencyScrollRef.current?.scrollTo({ left: frequencyScrollRef.current.scrollWidth });
  }, [frequencyChart.length]);

  if (loading) return <EmptyState>데이터를 불러오는 중입니다</EmptyState>;
  if (!frequencyChart.length) return <EmptyState>표시할 진행률 데이터가 없습니다.</EmptyState>;

  const yTicks = buildYTicks(frequencyYMax, Y_TICK_SEGMENTS);

  return (
    <div className="h-full flex relative">
      <div className="w-10 shrink-0 relative">
        <span className="absolute top-0 left-0.5 text-[9px] leading-none text-muted-foreground">(n)</span>
        <div
          className="absolute left-0 right-1 flex flex-col justify-between text-right text-[10px] text-muted-foreground"
          style={{ top: CHART_MARGIN_TOP, bottom: CHART_MARGIN_BOTTOM }}
        >
          {yTicks.map(tick => <span key={tick}>{tick}</span>)}
        </div>
      </div>
      <div
        ref={frequencyScrollRef}
        className={frequencyFillsFullWidth ? "flex-1 h-full relative overflow-hidden" : "flex-1 h-full overflow-x-auto overflow-y-hidden cursor-grab relative"}
      >
        <span className="absolute bottom-1 right-1 text-[9px] leading-none text-muted-foreground">(일)</span>
        <div
          style={{
            width: frequencyFillsFullWidth
              ? "100%"
              : Math.max(frequencyChart.length * FREQUENCY_POINT_WIDTH, FREQUENCY_WINDOW_DAYS * FREQUENCY_POINT_WIDTH),
            height: "100%",
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={frequencyChart} margin={{ top: CHART_MARGIN_TOP, right: 8, left: 0, bottom: CHART_MARGIN_BOTTOM }}>
              <defs>
                <linearGradient id="frequencyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7048E8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#7048E8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#8892A4" }}
                axisLine={{ stroke: "#94A3B8" }}
                tickLine={false}
              />
              <YAxis domain={[0, frequencyYMax]} hide />
              <Tooltip content={<FrequencyTooltip />} />
              <Area
                type="linear"
                dataKey="완료"
                stroke="#7048E8"
                strokeWidth={2}
                fill="url(#frequencyGradient)"
                dot={{ r: 3, fill: "#7048E8", strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
