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
      <Progress.Track className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <Progress.Indicator
          className="bg-primary h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${value ?? 0}%` }}
        />
      </Progress.Track>
      {showLabel && (
        <Progress.Value className="text-xs text-muted-foreground w-8 text-right font-medium shrink-0" />
      )}
    </Progress.Root>
  );
}

export { ProgressBar };
