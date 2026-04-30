import * as React from "react";

import { cn } from "#/web/lib/utils";

type StatusDotTone =
  | "timeline"
  | "timeline-muted"
  | "pending"
  | "active"
  | "done"
  | "blocked"
  | "skipped"
  | "stopped";

const toneClass: Record<StatusDotTone, string> = {
  timeline: "bg-timeline-dot",
  "timeline-muted": "border border-timeline-dot-muted bg-background",
  pending: "border border-task-pending bg-background",
  active: "bg-task-active ring-2 ring-primary/20",
  done: "bg-task-done",
  blocked: "bg-task-blocked",
  skipped: "bg-task-skipped",
  stopped: "bg-task-stopped",
};

export function StatusDot({ tone, className }: { tone: StatusDotTone; className?: string }) {
  return (
    <span className={cn("mt-1 block size-2 rounded-full shrink-0", toneClass[tone], className)} />
  );
}
