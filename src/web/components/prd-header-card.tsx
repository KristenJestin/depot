import { Clock3Icon } from "lucide-react";

import { AgentBars } from "#/web/components/agent-bars";
import { Markdown } from "#/web/components/markdown";
import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import { StatusBadge } from "#/web/components/ui/status-badge";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import { resolvePrdDisplayStatus, type DetailSummary } from "#/web/lib/prd-view-model";
import { formatMetaDate } from "#/web/lib/view-format";

type DetailPrd = PrdDetailResponse["prd"];

export function PrdHeaderCard({ prd, summary }: { prd: DetailPrd; summary: DetailSummary }) {
  const isSuperseded = prd.supersededAt !== null;
  const displayStatus = resolvePrdDisplayStatus(prd, summary.activeReview);
  const showReviewFooter = displayStatus === "review";
  const showActiveFooter = prd.status === "in_progress" && !showReviewFooter;
  const showDoneFooter = prd.status === "done";
  const showCanceledFooter = prd.status === "canceled";

  return (
    <Card>
      <div className="space-y-5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1
              className={[
                "text-3xl font-bold tracking-tight text-foreground",
                prd.status === "canceled" ? "text-muted-foreground line-through" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {prd.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Created {formatMetaDate(prd.createdAt)}</span>
              <span>·</span>
              <span>Updated {formatMetaDate(prd.updatedAt)}</span>
              <span>·</span>
              <span>Rev. {prd.revision}</span>
              <span>·</span>
              <span>Audit cycle {prd.auditCycles}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusBadge status={displayStatus} />
            {isSuperseded && <Badge variant="outline">superseded</Badge>}
          </div>
        </div>

        {prd.context && (
          <SpecBlock label="Context" value={prd.context} muted={prd.status === "canceled"} />
        )}
        {prd.scope && (
          <SpecBlock label="Scope" value={prd.scope} muted={prd.status === "canceled"} />
        )}
      </div>

      {showReviewFooter && (
        <Card.Footer className="mt-0 border-card-border bg-severity-info-soft px-4 py-3 text-xs text-severity-info">
          <span>{summary.currentCycleLabel ?? "Awaiting human review"}</span>
          <span className="ml-auto">Waiting on feedback</span>
        </Card.Footer>
      )}

      {showActiveFooter && (
        <Card.Footer className="mt-0 border-card-border px-4 py-3 text-xs text-status-in-progress-foreground">
          <span className="flex items-center gap-2">
            <AgentBars />
            <span>{summary.currentCycleLabel ?? "Working"}</span>
          </span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            <Clock3Icon className="size-3" />
            Active
          </span>
        </Card.Footer>
      )}

      {showDoneFooter && (
        <Card.Footer className="mt-0 border-card-border bg-status-done-soft px-4 py-3 text-xs text-status-done-foreground">
          <span>All {summary.totalTasks} tasks complete</span>
          <span className="ml-auto">{formatMetaDate(prd.updatedAt)}</span>
        </Card.Footer>
      )}

      {showCanceledFooter && (
        <Card.Footer className="mt-0 border-card-border bg-status-canceled-soft px-4 py-3 text-xs text-status-canceled-foreground">
          <span>
            Canceled · {summary.doneTasks} / {summary.totalTasks} tasks completed
          </span>
          <span className="ml-auto">{formatMetaDate(prd.updatedAt)}</span>
        </Card.Footer>
      )}
    </Card>
  );
}

function SpecBlock({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <section className="space-y-2 border-t border-card-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <Markdown
        source={value}
        className={[
          "text-sm leading-6",
          muted ? "text-muted-foreground" : "text-secondary-foreground",
        ].join(" ")}
      />
    </section>
  );
}
