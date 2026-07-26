export interface CircleProgressSegment {
  value: number;
  color: string;
}

/** segments를 주면 값 비율대로 여러 색 구간(도넛)을 그리고, 안 주면 기존처럼 pct 하나만 그린다. */
export function CircleProgress({ pct, size = 160, segments }: { pct: number; size?: number; segments?: CircleProgressSegment[] }) {
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;

  if (segments && segments.length > 0) {
    const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
    let offset = 0;
    return (
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF1F8" strokeWidth="14" />
        {segments.map((seg, i) => {
          const dash = (seg.value / total) * circ;
          const circle = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth="14"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              stroke={seg.color}
              style={{ transition: "stroke-dasharray 0.8s ease-out" }}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
    );
  }

  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF1F8" strokeWidth="14" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`} stroke="url(#cpg)"
        style={{ transition: "stroke-dasharray 0.8s ease-out" }} />
      <defs>
        <linearGradient id="cpg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3B5BDB" /><stop offset="100%" stopColor="#7048E8" />
        </linearGradient>
      </defs>
    </svg>
  );
}
