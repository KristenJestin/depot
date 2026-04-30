import * as React from "react";

import { cn } from "#/web/lib/utils";

type TerminalLineVariant = "default" | "command" | "success" | "warning" | "muted";

const lineVariantClass: Record<TerminalLineVariant, string> = {
  default: "text-card-foreground/90",
  command: "text-primary",
  success: "text-success",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

function TerminalLine({
  variant = "default",
  children,
  className,
}: {
  variant?: TerminalLineVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(lineVariantClass[variant], className)}>{children}</div>;
}

function Terminal({
  label,
  height = "max-h-64",
  className,
  children,
}: {
  label?: string;
  height?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-card-border bg-card shadow-card",
        className,
      )}
    >
      {label && (
        <div className="flex items-center justify-center border-b border-card-border bg-panel-muted px-4 py-2">
          <span className="font-mono text-xs text-muted-foreground">{label}</span>
        </div>
      )}
      <div className={cn("space-y-2 overflow-y-auto p-4 font-mono text-sm", height)}>
        {children}
      </div>
    </div>
  );
}

export { Terminal, TerminalLine };
export type { TerminalLineVariant };
