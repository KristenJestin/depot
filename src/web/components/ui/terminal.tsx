import * as React from "react";

import { cn } from "#/web/lib/utils";

type TerminalLineVariant = "default" | "command" | "success" | "warning" | "muted";

const lineVariantClass: Record<TerminalLineVariant, string> = {
  default: "text-gray-300",
  command: "text-blue-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  muted: "text-gray-500",
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
  height = "h-64",
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
        "bg-[#0d1117] border border-[#1e293b] rounded-xl overflow-hidden shadow-xl",
        className,
      )}
    >
      {label && (
        <div className="flex items-center justify-center px-4 py-2 border-b border-[#1e293b] bg-[#161b22]">
          <span className="font-mono text-2xs text-gray-400">{label}</span>
        </div>
      )}
      <div className={cn("p-4 font-mono text-sm space-y-1.5 overflow-y-auto", height)}>
        {children}
      </div>
    </div>
  );
}

export { Terminal, TerminalLine };
export type { TerminalLineVariant };
