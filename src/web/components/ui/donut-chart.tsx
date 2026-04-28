interface Segment {
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: Segment[];
  size?: number;
  strokeWidth?: number;
}

export function DonutChart({ segments, size = 72, strokeWidth = 8 }: DonutChartProps) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let cumulativeOffset = 0;
  const arcs = segments.map((seg) => {
    const dash = total > 0 ? (seg.value / total) * circumference : 0;
    const offset = cumulativeOffset;
    cumulativeOffset += dash;
    return { ...seg, dash, offset };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Background track */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        className="text-border"
        strokeWidth={strokeWidth}
      />
      {total > 0 &&
        arcs.map((arc, i) =>
          arc.dash > 0 ? (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
              strokeDashoffset={-arc.offset}
            />
          ) : null,
        )}
    </svg>
  );
}
