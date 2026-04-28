import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { StatusBadge } from "./ui/status-badge";

interface Finding {
  id: string;
  title: string;
  severity: string | null;
  status: string;
}

interface FindingsTableProps {
  findings: Finding[];
  prdId: string;
  onViewAll?: () => void;
}

const severityIcon: Record<string, { icon: string; className: string }> = {
  critical: { icon: "●", className: "text-destructive" },
  major: { icon: "▲", className: "text-chart-4" },
  minor: { icon: "–", className: "text-chart-3" },
  info: { icon: "ℹ", className: "text-muted-foreground" },
};

export function FindingsTable({ findings, prdId, onViewAll }: FindingsTableProps) {
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">Findings ({findings.length})</span>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-xs text-primary hover:underline"
          >
            View all findings →
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {findings.map((f, i) => {
          const sev =
            (f.severity !== null ? severityIcon[f.severity] : undefined) ?? severityIcon["info"]!;
          return (
            <div
              key={f.id}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-secondary/40 cursor-pointer"
              onClick={() =>
                navigate({ to: "/prds/$id/tasks/$taskId", params: { id: prdId, taskId: f.id } })
              }
            >
              <span className={`w-4 text-center text-xs shrink-0 ${sev.className}`}>
                {sev.icon}
              </span>
              <span className="font-mono text-xs text-muted-foreground w-9 shrink-0">
                F-{i + 1}
              </span>
              <span className="shrink-0">
                <StatusBadge status={f.status} />
              </span>
              <span className="text-sm truncate flex-1">{f.title}</span>
              <ChevronRightIcon className="size-3 text-muted-foreground/50 shrink-0" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
