export function CircleProgress({ pct, size = 160 }: { pct: number; size?: number }) {
  const r = size / 2 - 14;
  const circ = 2 * Math.PI * r;
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
