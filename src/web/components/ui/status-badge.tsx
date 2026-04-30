import * as React from "react";
import {
  BadgeXIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CirclePlayIcon,
  CircleSlash2Icon,
  Clock3Icon,
} from "lucide-react";

import { Badge } from "#/web/components/ui/badge";
import { cn } from "#/web/lib/utils";
import type { PrdStatus, TaskStatus } from "#/shared/validator";

type AllStatus = PrdStatus | TaskStatus;

const statusLabel: Record<AllStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  canceled: "Canceled",
  pending: "Pending",
  blocked: "Blocked",
  skipped: "Skipped",
  in_progress: "In Progress",
  done: "Done",
};

const statusVariant: Record<AllStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  draft: "statusDraft",
  ready: "statusReady",
  canceled: "statusCanceled",
  pending: "outline",
  blocked: "statusInProgress",
  skipped: "outline",
  in_progress: "statusInProgress",
  done: "statusDone",
};

type IconComponent = React.ComponentType<{ className?: string }>;

const statusIcon: Record<AllStatus, IconComponent> = {
  draft: CircleDashedIcon,
  ready: CirclePlayIcon,
  canceled: CircleSlash2Icon,
  pending: CircleIcon,
  blocked: BadgeXIcon,
  skipped: CircleSlash2Icon,
  in_progress: Clock3Icon,
  done: CircleCheckIcon,
};

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: AllStatus | string | null | undefined;
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const knownStatus = status as AllStatus;
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
