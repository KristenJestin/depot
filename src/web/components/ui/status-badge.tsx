import * as React from "react";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleMinusIcon,
  CircleXIcon,
} from "lucide-react";

import { cn } from "#/web/lib/utils";
import type { PrdStatus, TaskStatus } from "#/shared/validator";

type AllStatus = PrdStatus | TaskStatus;

const statusColor: Record<AllStatus, string> = {
  // PRD
  draft: "bg-foreground/10 text-muted-foreground",
  ready: "bg-chart-3/15 text-chart-3",
  canceled: "bg-destructive/15 text-destructive",
  // Task
  pending: "bg-foreground/10 text-muted-foreground",
  blocked: "bg-chart-4/15 text-chart-4",
  skipped: "bg-foreground/10 text-muted-foreground",
  // Common
  in_progress: "bg-chart-1/15 text-chart-1",
  done: "bg-chart-5/15 text-chart-5",
};

const statusLabel: Record<AllStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  canceled: "Canceled",
  pending: "Pending",
  blocked: "Blocked",
  skipped: "Skipped",
  in_progress: "In progress",
  done: "Done",
};

type IconComponent = React.ComponentType<{ className?: string }>;

const statusIcon: Record<AllStatus, IconComponent> = {
  draft: CircleDashedIcon,
  ready: CircleCheckIcon,
  canceled: CircleXIcon,
  pending: CircleDashedIcon,
  blocked: CircleXIcon,
  skipped: CircleMinusIcon,
  in_progress: CircleDotIcon,
  done: CircleCheckIcon,
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: AllStatus | string | null | undefined;
}

function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const knownStatus = status as AllStatus;
  const Icon = statusIcon[knownStatus];

  if (!Icon) return null;

  const isActive = knownStatus === "in_progress";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium",
        statusColor[knownStatus],
        className,
      )}
      {...props}
    >
      <Icon className={cn("size-3 shrink-0", isActive && "animate-pulse")} />
      {statusLabel[knownStatus]}
    </span>
  );
}

export { StatusBadge };
