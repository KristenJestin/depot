import * as React from "react";

import { cn } from "#/web/lib/utils";
import type { DotLoaderProps, DotPattern } from "./types";
import { PRESETS } from "./presets";

const shapeRadius: Record<string, string> = {
  circle: "50%",
  rounded: "30%",
  square: "2px",
};

const BLINK_PATTERNS = new Set<DotPattern>(["scan-h", "scan-v", "fill", "spinner"]);

export function computeDelay(
  row: number,
  col: number,
  rows: number,
  cols: number,
  pattern: DotPattern,
  duration: number,
  step: number,
): number {
  switch (pattern) {
    case "wave-diagonal":
      return (row + col) * step;
    case "wave-diagonal-reverse":
      return (rows - 1 - row + col) * step;
    case "wave-horizontal":
      return col * step;
    case "wave-vertical":
      return row * step;
    case "pulse":
      return 0;
    case "ripple":
      return Math.hypot(row - (rows - 1) / 2, col - (cols - 1) / 2) * step;
    case "random":
      return (((row * 31 + col * 17) % 97) / 97) * duration;
    case "scan-h":
      return (col / cols) * duration;
    case "scan-v":
      return (row / rows) * duration;
    case "fill":
      return ((row * cols + col) / (rows * cols)) * duration;
    case "spinner": {
      const angle = Math.atan2(row - (rows - 1) / 2, col - (cols - 1) / 2);
      return ((angle + Math.PI) / (2 * Math.PI)) * duration;
    }
  }
}

export function DotLoader({
  preset,
  rows: rowsProp,
  cols: colsProp,
  dotSize: dotSizeProp,
  gap: gapProp,
  shape: shapeProp,
  color: colorProp,
  dimOpacity: dimOpacityProp,
  pattern: patternProp,
  speed: speedProp,
  step: stepProp,
  label,
  className,
}: DotLoaderProps) {
  const base = preset ? PRESETS[preset] : {};
  const rows = rowsProp ?? base.rows ?? 5;
  const cols = colsProp ?? base.cols ?? rows;
  const dotSize = dotSizeProp ?? base.dotSize ?? 8;
  const gap = gapProp ?? base.gap ?? 4;
  const shape = shapeProp ?? base.shape ?? "circle";
  const color = colorProp ?? base.color ?? "var(--color-chart-1)";
  const dimOpacity = dimOpacityProp ?? base.dimOpacity ?? 0.12;
  const pattern = patternProp ?? base.pattern ?? "wave-diagonal";
  const speed = speedProp ?? base.speed ?? 16;

  const duration = Math.round(2600 / speed);
  const step = stepProp ?? base.step ?? duration / (rows + cols);

  const keyframe = BLINK_PATTERNS.has(pattern) ? "dot-blink" : "dot-beat";
  const easing = BLINK_PATTERNS.has(pattern) ? "linear" : "cubic-bezier(0.37, 0, 0.63, 1)";

  const dots = Array.from({ length: rows * cols }, (_, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const delay = computeDelay(row, col, rows, cols, pattern, duration, step);
    return { row, col, delay };
  });

  return (
    <div
      role="status"
      aria-label={label ?? "Loading"}
      className={cn("inline-flex items-center gap-3", className)}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`,
          gap: `${gap}px`,
        }}
      >
        {dots.map(({ row, col, delay }) => (
          <span
            key={`${row}-${col}`}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: shapeRadius[shape],
              backgroundColor: color,
              ["--dot-min-opacity" as string]: dimOpacity,
              animationName: keyframe,
              animationDuration: `${duration}ms`,
              animationDelay: `-${delay}ms`,
              animationTimingFunction: easing,
              animationIterationCount: "infinite",
              animationFillMode: "both",
            }}
          />
        ))}
      </div>
      {label && <span className="text-sm font-medium text-foreground">{label}</span>}
    </div>
  );
}
