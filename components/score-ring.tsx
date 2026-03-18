export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = Math.round(size * 0.36);
  const cx = size / 2;
  const cy = size / 2;
  const sw = Math.round(size * 0.08);
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const color = score >= 80 ? "#1d6b52" : score >= 60 ? "#b95c28" : "#9ca3af";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth={sw} />
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
      <text
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={Math.round(size * 0.26)}
        fontWeight="700"
        fill={color}
        fontFamily="Space Grotesk, sans-serif"
      >
        {score}
      </text>
    </svg>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const palette = ["#1d6b52", "#b95c28", "#5c4d8a", "#2563eb", "#c2410c"];
  const color = palette[name.charCodeAt(0) % palette.length];
  const fs = Math.round(size * 0.36);

  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: color + "18",
      border: `2px solid ${color}35`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Space Grotesk, sans-serif",
      fontWeight: 700, fontSize: fs, color,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}
