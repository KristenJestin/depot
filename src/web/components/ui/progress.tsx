import { Progress } from "@base-ui/react/progress";
import * as React from "react";

import { cn } from "#/web/lib/utils";

export interface ProgressBarProps {
  value: number | null;
  showLabel?: boolean;
  className?: string;
}

function ProgressBar({ value, showLabel = false, className }: ProgressBarProps) {
  return (
    <Progress.Root value={value} className={cn("flex items-center gap-3 w-full", className)}>
      <Progress.Track className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <Progress.Indicator
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${value ?? 0}%` }}
        />
      </Progress.Track>
      {showLabel && (
        <Progress.Value className="w-8 shrink-0 text-right text-xs font-medium text-muted-foreground" />
      )}
    </Progress.Root>
  );
}

export { ProgressBar };
