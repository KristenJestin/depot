import * as React from "react";
import {
  BadgeXIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CirclePlayIcon,
  CircleSlash2Icon,
  Clock3Icon,
  RefreshCcwDotIcon,
} from "lucide-react";

import { Badge } from "#/web/components/ui/badge";
import { cn } from "#/web/lib/utils";
import type { PrdStatus, TaskStatus } from "#/shared/validator";

type AllStatus = PrdStatus | TaskStatus;
type DisplayStatus = AllStatus | "review";

const statusLabel: Record<DisplayStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  canceled: "Canceled",
  pending: "Pending",
  blocked: "Blocked",
  skipped: "Skipped",
  in_progress: "In Progress",
  done: "Done",
  review: "Review",
};

const statusVariant: Record<DisplayStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  draft: "statusDraft",
  ready: "statusReady",
  canceled: "statusCanceled",
  pending: "outline",
  blocked: "statusInProgress",
  skipped: "outline",
  in_progress: "statusInProgress",
  done: "statusDone",
  review: "severityInfo",
};

type IconComponent = React.ComponentType<{ className?: string }>;

const statusIcon: Record<DisplayStatus, IconComponent> = {
  draft: CircleDashedIcon,
  ready: CirclePlayIcon,
  canceled: CircleSlash2Icon,
  pending: CircleIcon,
  blocked: BadgeXIcon,
  skipped: CircleSlash2Icon,
  in_progress: Clock3Icon,
  done: CircleCheckIcon,
  review: RefreshCcwDotIcon,
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: DisplayStatus | string | null | undefined;
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const knownStatus = status as DisplayStatus;
  const Icon = statusIcon[knownStatus];

  if (!Icon) {
    return null;
  }

  return (
    <Badge
      className={cn("rounded-lg px-2 py-1 text-xs", className)}
      variant={statusVariant[knownStatus]}
      {...props}
    >
      <Icon className={cn("size-3 shrink-0", knownStatus === "in_progress" && "animate-pulse")} />
      {statusLabel[knownStatus]}
    </Badge>
  );
}
