export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 960 620"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      preserveAspectRatio="xMidYMin slice"
    >
      <defs>
        <linearGradient id="hi-window" x1="0" y1="0" x2="0" y2="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#161B33" />
          <stop offset="1" stopColor="#10142A" />
        </linearGradient>
        <linearGradient id="hi-sidebar" x1="0" y1="0" x2="0" y2="620" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#12162C" />
          <stop offset="1" stopColor="#0C0F22" />
        </linearGradient>
        <linearGradient id="hi-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6C8CFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="hi-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C6CFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7C6CFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hi-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6C8CFF" />
          <stop offset="1" stopColor="#B98CFF" />
        </linearGradient>
        <clipPath id="hi-round">
          <rect x="0" y="0" width="960" height="620" rx="22" />
        </clipPath>
      </defs>

      <g clipPath="url(#hi-round)">
        <rect x="0" y="0" width="960" height="620" fill="url(#hi-window)" />

        {/* Top bar */}
        <rect x="0" y="0" width="960" height="46" fill="#0E1226" />
        <circle cx="26" cy="23" r="6" fill="#F97066" />
        <circle cx="48" cy="23" r="6" fill="#F7B750" />
        <circle cx="70" cy="23" r="6" fill="#3FCF8E" />
        <rect x="110" y="14" width="260" height="18" rx="9" fill="#FFFFFF" opacity="0.06" />
        <rect x="860" y="13" width="20" height="20" rx="6" fill="#FFFFFF" opacity="0.08" />
        <rect x="900" y="13" width="20" height="20" rx="6" fill="#FFFFFF" opacity="0.08" />

        {/* Sidebar */}
        <rect x="0" y="46" width="200" height="574" fill="url(#hi-sidebar)" />
        <rect x="24" y="76" width="30" height="30" rx="9" fill="url(#hi-logo)" />
        <rect x="64" y="83" width="90" height="8" rx="4" fill="#FFFFFF" opacity="0.35" />
        <rect x="64" y="97" width="60" height="6" rx="3" fill="#FFFFFF" opacity="0.18" />

        <rect x="20" y="136" width="164" height="34" rx="10" fill="#4F6EF7" opacity="0.22" />
        <rect x="34" y="147" width="12" height="12" rx="3" fill="#8FA4FF" />
        <rect x="54" y="149" width="100" height="8" rx="4" fill="#C7D2FE" />
        {[184, 228, 272, 316, 360].map((y, i) => (
          <g key={y}>
            <rect x="34" y={y + 11} width="12" height="12" rx="3" fill="#FFFFFF" opacity="0.16" />
            <rect x="54" y={y + 13} width={i % 2 === 0 ? 84 : 68} height="8" rx="4" fill="#FFFFFF" opacity="0.14" />
          </g>
        ))}

        <rect x="20" y="560" width="164" height="40" rx="12" fill="#FFFFFF" opacity="0.05" />
        <circle cx="40" cy="580" r="12" fill="#FFFFFF" opacity="0.14" />
        <rect x="60" y="574" width="80" height="7" rx="3.5" fill="#FFFFFF" opacity="0.3" />
        <rect x="60" y="585" width="50" height="6" rx="3" fill="#FFFFFF" opacity="0.16" />

        {/* Main content */}
        <rect x="224" y="68" width="90" height="10" rx="5" fill="#FFFFFF" opacity="0.28" />

        {/* Stat cards */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${224 + i * 186}, 96)`}>
            <rect width="170" height="96" rx="16" fill="#171C36" stroke="#FFFFFF" strokeOpacity="0.06" />
            <rect x="18" y="18" width="30" height="30" rx="9" fill={["#4F6EF7", "#8B5CF6", "#3FCF8E", "#F7B750"][i]} opacity="0.22" />
            <rect x="24" y="24" width="18" height="18" rx="5" fill={["#8FA4FF", "#C4A5FF", "#7BE3B4", "#FBD08A"][i]} />
            <rect x="18" y="60" width="60" height="12" rx="6" fill="#FFFFFF" opacity="0.32" />
            <rect x="18" y="78" width="90" height="7" rx="3.5" fill="#FFFFFF" opacity="0.15" />
          </g>
        ))}

        {/* Chart card */}
        <g transform="translate(224, 216)">
          <rect width="462" height="200" rx="18" fill="#171C36" stroke="#FFFFFF" strokeOpacity="0.06" />
          <rect x="24" y="24" width="120" height="10" rx="5" fill="#FFFFFF" opacity="0.3" />
          <rect x="24" y="42" width="70" height="7" rx="3.5" fill="#FFFFFF" opacity="0.14" />
          <line x1="24" y1="176" x2="438" y2="176" stroke="#FFFFFF" strokeOpacity="0.08" />
          <line x1="24" y1="140" x2="438" y2="140" stroke="#FFFFFF" strokeOpacity="0.05" />
          <line x1="24" y1="104" x2="438" y2="104" stroke="#FFFFFF" strokeOpacity="0.05" />
          <path
            d="M24 150 L90 138 L156 152 L222 96 L288 84 L354 92 L420 62 L438 58 L438 176 L24 176 Z"
            fill="url(#hi-area)"
          />
          <path
            d="M24 150 L90 138 L156 152 L222 96 L288 84 L354 92 L420 62 L438 58"
            fill="none"
            stroke="url(#hi-line)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[[24, 150], [90, 138], [156, 152], [222, 96], [288, 84], [354, 92], [420, 62]].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="4" fill="#0B0A1A" stroke="#B0A2FF" strokeWidth="2" />
          ))}
        </g>

        {/* Side list card */}
        <g transform="translate(710, 216)">
          <rect width="200" height="200" rx="18" fill="#171C36" stroke="#FFFFFF" strokeOpacity="0.06" />
          <rect x="20" y="22" width="90" height="10" rx="5" fill="#FFFFFF" opacity="0.3" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(20, ${52 + i * 36})`}>
              <circle cx="12" cy="10" r="10" fill={["#4F6EF7", "#8B5CF6", "#3FCF8E", "#F7B750"][i]} opacity="0.5" />
              <rect x="32" y="4" width="90" height="7" rx="3.5" fill="#FFFFFF" opacity="0.26" />
              <rect x="32" y="15" width="60" height="6" rx="3" fill="#FFFFFF" opacity="0.13" />
            </g>
          ))}
        </g>

        {/* Table card (intentionally extends toward the crop edge) */}
        <g transform="translate(224, 440)">
          <rect width="686" height="160" rx="18" fill="#171C36" stroke="#FFFFFF" strokeOpacity="0.06" />
          <rect x="24" y="24" width="140" height="10" rx="5" fill="#FFFFFF" opacity="0.28" />
          {[0, 1, 2].map((row) => (
            <g key={row} transform={`translate(24, ${54 + row * 34})`}>
              <rect width="200" height="8" rx="4" fill="#FFFFFF" opacity="0.16" />
              <rect x="240" width="140" height="8" rx="4" fill="#FFFFFF" opacity="0.1" />
              <rect x="420" width="90" height="8" rx="4" fill="#FFFFFF" opacity="0.1" />
              <rect
                x="560"
                y="-4"
                width="64"
                height="18"
                rx="9"
                fill={["#3FCF8E", "#4F6EF7", "#F7B750"][row]}
                opacity="0.22"
              />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
