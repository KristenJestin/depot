import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "./ui/badge";
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

const severityVariant: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  critical: "severityCritical",
  major: "severityMajor",
  minor: "severityMinor",
  info: "severityInfo",
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
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <span>View all findings</span>
            <ArrowRightIcon className="size-3" />
          </button>
        )}
      </div>
      <div className="divide-y divide-border">
        {findings.map((f, i) => {
          const severity = f.severity ?? "info";
          return (
            <div
              key={f.id}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-secondary/40 cursor-pointer"
              onClick={() => navigate({ to: "/prds/$id", params: { id: prdId } })}
            >
              <span className="shrink-0">
                <Badge variant={severityVariant[severity]}>{severity}</Badge>
              </span>
              <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">
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
