import * as React from "react";

import { cn } from "#/web/lib/utils";

export type CliLineType = "command" | "output";

export interface CliLine {
  text: string;
  type: CliLineType;
}

export interface CliActivityLogProps {
  lines: CliLine[];
  className?: string;
}

function CliActivityLog({ lines, className }: CliActivityLogProps) {
  return (
    <div
      className={cn(
        "space-y-1 overflow-y-auto rounded-md border border-border bg-background/50 p-2 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      {lines.map((line, i) => (
        <div key={i} className={cn(line.type === "output" && "text-primary")}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

export { CliActivityLog };
