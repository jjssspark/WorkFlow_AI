import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
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
// 플롯 영역을 조금 줄여서, 날짜 라벨 줄과 "(일)" 단위 줄이 서로 겹치지 않고
// 아래쪽에 각각 별도의 줄로 들어갈 여백을 확보한다.
export const CHART_MARGIN_BOTTOM = 32;
export const Y_TICK_SEGMENTS = 4;
const AXIS_PADDING_X = 16;
const FULL_WIDTH_VIEWBOX = 1000;

/** 고정 Y축(CSS) 눈금 값 — 차트의 margin.top/bottom과 정확히 같은 픽셀 기준으로 겹쳐 그린다. */
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

/** '업무가 완료 처리(status=done)된 날짜'(doneDate)만을 x축으로 삼아
 * 프로젝트 시작일~(마감일 또는 오늘) 범위의 누적 완료 업무량을 계산한다.
 * 오늘 완료 처리가 없었어도 차트가 항상 "오늘"까지 이어지도록 마지막 포인트로 오늘을 포함시킨다. */
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
    if (normalizeTaskStatus(task.status) === "done" && task.doneDate) changeDates.add(dateKeyOf(task.doneDate));
  });
  if (todayKey >= rangeStart && todayKey <= rangeEnd) changeDates.add(todayKey);

  const sortedDates = Array.from(changeDates)
    .filter(dateKey => dateKey >= rangeStart && dateKey <= rangeEnd)
    .sort();

  let previousDone = 0;
  const points = sortedDates.map(dateKey => {
    const total = tasks.filter(task => task.createdAt && dateKeyOf(task.createdAt) <= dateKey).length;
    const done = tasks.filter(
      task => normalizeTaskStatus(task.status) === "done" && task.doneDate && dateKeyOf(task.doneDate) <= dateKey
    ).length;
    const dailyDoneCount = done - previousDone;
    previousDone = done;
    return { dateKey, label: formatDashboardDueDate(dateKey), 전체: total, 완료: done, dailyDoneCount };
  });

  const lastPoint = points[points.length - 1];
  if (lastPoint && lastPoint.dateKey === todayKey) lastPoint.label = "오늘";
  return points;
}

/** '전체 진행률' 카드(대시보드)와 '계획 대비 실제 진행률' 카드(전체 진행률 페이지)가 함께 쓰는
 * 완료 업무 누적 빈도 그래프 — 단일 선 + 그라데이션 영역, 7일 스크롤 윈도우.
 *
 * recharts의 AreaChart/XAxis 조합에서 x축이 반복적으로 y=0이 아닌 중간 높이(대략 데이터 값
 * 위치)에 떠서 그려지는 문제가 있었다 — margin/padding 조정, 단일 차트 인스턴스로의 구조 변경,
 * 퍼센트 대신 확정 픽셀 높이로 바꾸는 시도까지 모두 해봐도 재현되어, recharts를 아예 걷어내고
 * SVG 좌표를 직접 계산해서 그린다. x축 라인은 항상 `bottomY = CHART_MARGIN_TOP + plotHeight`에
 * 고정으로 그리므로 라이브러리 내부 배치 로직에 좌우될 여지가 없다. */
export function ProgressFrequencyChart({
  tasks,
  projectStart,
  projectDeadline,
  totalTasks,
  loading,
  heightPx = 160,
}: {
  tasks: DashboardTaskDto[];
  projectStart: string | null;
  projectDeadline: string | null;
  totalTasks: number;
  loading: boolean;
  heightPx?: number;
}) {
  const frequencyChart = buildFrequencyChart(tasks, projectStart, projectDeadline);
  const frequencyYMax = Math.max(totalTasks, 1);
  // 한 화면(윈도우)에는 항상 7일치만 보이게 한다 — 포인트 수가 7 이하면 카드 폭을 꽉 채우고,
  // 7을 넘으면 "포인트 수/7" 비율만큼 콘텐츠 폭을 넓혀 초과분을 가로 스크롤로 보게 한다
  // (픽셀 고정폭 대신 %로 계산해서, 카드가 넓을 때 오른쪽에 빈 여백이 남지 않는다).
  const frequencyFillsFullWidth = frequencyChart.length <= FREQUENCY_WINDOW_DAYS;
  const frequencyScrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // 윈도우 시작값=오늘로부터 7일 전 — 로드/데이터 변경 시 항상 최신(가장 오른쪽) 구간으로 스크롤한다.
    frequencyScrollRef.current?.scrollTo({ left: frequencyScrollRef.current.scrollWidth });
  }, [frequencyChart.length]);

  if (loading) return <EmptyState>데이터를 불러오는 중입니다</EmptyState>;
  if (!frequencyChart.length) return <EmptyState>표시할 진행률 데이터가 없습니다.</EmptyState>;

  const yTicks = buildYTicks(frequencyYMax, Y_TICK_SEGMENTS);
  const n = frequencyChart.length;
  const plotHeight = heightPx - CHART_MARGIN_TOP - CHART_MARGIN_BOTTOM;
  const bottomY = CHART_MARGIN_TOP + plotHeight;

  const widthPercent = frequencyFillsFullWidth ? 100 : (n / FREQUENCY_WINDOW_DAYS) * 100;
  const viewBoxWidth = FULL_WIDTH_VIEWBOX;

  const xFor = (index: number) => {
    const usable = viewBoxWidth - AXIS_PADDING_X * 2;
    return n <= 1 ? viewBoxWidth / 2 : AXIS_PADDING_X + (index / (n - 1)) * usable;
  };
  const yFor = (value: number) => {
    const ratio = frequencyYMax <= 0 ? 0 : value / frequencyYMax;
    return CHART_MARGIN_TOP + (1 - ratio) * plotHeight;
  };

  const coords = frequencyChart.map((point, index) => ({ x: xFor(index), y: yFor(point.완료), point }));
  const lineD = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaD = `${lineD} L ${coords[coords.length - 1].x} ${bottomY} L ${coords[0].x} ${bottomY} Z`;

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBoxWidth / rect.width;
    const localX = (event.clientX - rect.left) * scaleX;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const dist = Math.abs(c.x - localX);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });
    setHoverIndex(nearest);
    // 뷰포트 기준(clientX/clientY) 좌표로 저장 — position:fixed 포털로 그려서 카드/다른
    // 요소의 overflow나 낮은 z-index에 가려지지 않도록 한다(팝업/모달 제외).
    setHoverPos({ x: event.clientX, y: rect.top + 4 });
  };

  const hoverPoint = hoverIndex != null ? frequencyChart[hoverIndex] : null;

  return (
    <div className="flex relative" style={{ height: heightPx }}>
      <div className="w-10 shrink-0 relative" style={{ height: heightPx }}>
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
        className={`scrollbar-none ${frequencyFillsFullWidth ? "flex-1 relative overflow-hidden" : "flex-1 overflow-x-auto overflow-y-hidden cursor-grab relative"}`}
        style={{ height: heightPx }}
      >
        <div style={{ width: `${widthPercent}%`, height: heightPx }}>
          <svg
            ref={svgRef}
            width="100%"
            height={heightPx}
            viewBox={`0 0 ${viewBoxWidth} ${heightPx}`}
            preserveAspectRatio="none"
            onMouseMove={handleMove}
            onMouseLeave={() => { setHoverIndex(null); setHoverPos(null); }}
          >
            <defs>
              <linearGradient id="frequencyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {yTicks.map(tick => (
              <line
                key={tick}
                x1={0}
                x2={viewBoxWidth}
                y1={yFor(tick)}
                y2={yFor(tick)}
                stroke="rgba(0,0,0,0.06)"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={areaD} fill="url(#frequencyGradient)" stroke="none" />
            <path d={lineD} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {coords.map(c => (
              <circle key={c.point.dateKey} cx={c.x} cy={c.y} r={3} fill="var(--primary)" />
            ))}
            {hoverIndex != null && (
              <line x1={coords[hoverIndex].x} x2={coords[hoverIndex].x} y1={CHART_MARGIN_TOP} y2={bottomY} stroke="var(--muted-foreground)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
            {/* x축 라인 — 항상 플롯 영역의 진짜 바닥(bottomY)에 고정 */}
            <line x1={0} x2={viewBoxWidth} y1={bottomY} y2={bottomY} stroke="var(--muted-foreground)" vectorEffect="non-scaling-stroke" />
            {coords.map(c => (
              <text key={c.point.dateKey} x={c.x} y={bottomY + 14} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
                {c.point.label}
              </text>
            ))}
          </svg>
          {hoverPoint && hoverPos && createPortal(
            <div
              className="fixed rounded-lg bg-card shadow-lg border border-border px-3 py-2 text-[11px] space-y-0.5 pointer-events-none"
              style={{ left: hoverPos.x, top: hoverPos.y, transform: "translateX(-50%)", zIndex: 9999 }}
            >
              <div className="font-semibold text-foreground whitespace-nowrap">
                {hoverPoint.dateKey === dateKeyOf(new Date().toISOString()) ? `오늘 (${hoverPoint.dateKey})` : hoverPoint.label}
              </div>
              <div className="text-muted-foreground whitespace-nowrap">전체 업무량: <span className="font-medium text-foreground">{hoverPoint.전체}개</span></div>
              <div className="text-muted-foreground whitespace-nowrap">일일 진행량: <span className="font-medium text-foreground">{hoverPoint.dailyDoneCount}개</span></div>
            </div>,
            document.body
          )}
        </div>
      </div>
      <div className="w-6 shrink-0 relative" style={{ height: heightPx }}>
        <span className="absolute bottom-0 right-0 text-[9px] leading-none text-muted-foreground">(일)</span>
      </div>
    </div>
  );
}
