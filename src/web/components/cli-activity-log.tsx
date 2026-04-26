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
        "font-mono text-2xs text-muted-foreground bg-background/50 border border-border rounded-md p-2 space-y-1 overflow-y-auto",
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
