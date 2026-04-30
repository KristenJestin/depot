import type { FindingTask } from "../lib/api-types";
import { cn } from "../lib/utils";
import { X } from "lucide-react";

function FindingBar({ severity }: { severity: string | null }) {
  return (
    <div
      className={cn(
        "w-1 min-h-8 rounded-sm shrink-0 mt-0.5",
        severity === "critical" ? "bg-destructive" : "bg-warning",
      )}
    />
  );
}

export function FindingRow({ finding }: { finding: FindingTask }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b  ">
      <FindingBar severity={finding.severity} />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "mb-0.5 font-mono text-xs tracking-wider",
            finding.severity === "critical" ? "text-destructive" : "text-warning",
          )}
        >
          {finding.severity}
        </div>
        <div className="text-xs text-muted-foreground leading-snug">{finding.title}</div>
      </div>
    </div>
  );
}

export function FindingsPanel({
  findings,
  onClose,
}: {
  findings: FindingTask[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <div className="fixed right-0 top-0 bottom-0 w-80 bg-card border-l border-border z-50 overflow-y-auto animate-slide-in-right">
        <div className="flex items-center justify-between shrink-0 h-11 px-4 border-b border-border">
          <span className="text-sm font-semibold">Findings</span>
          <button
            onClick={onClose}
            className="bg-transparent border-none cursor-pointer text-muted-foreground p-1"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <div className="px-4 py-2">
          {findings.map((f, i) => (
            <FindingRow key={i} finding={f} />
          ))}
        </div>
      </div>
    </div>
  );
}
