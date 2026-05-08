import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "#/web/components/ui/collapsible";
import { StatusBadge } from "#/web/components/ui/status-badge";
import { StatusDot } from "#/web/components/ui/status-dot";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import {
  resolvePrdDisplayStatus,
  type DetailSummary,
  type RevisionEntry,
} from "#/web/lib/prd-view-model";
import { formatMetaDate } from "#/web/lib/view-format";

type DetailPrd = PrdDetailResponse["prd"];
type DetailReview = PrdDetailResponse["reviews"][number];
type DetailActivity = PrdDetailResponse["activity"][number];
type DetailWorkspace = PrdDetailResponse["workspace"];

export function PrdSidebar({
  prd,
  workspace,
  revisions,
  reviews,
  activity,
  summary,
}: {
  prd: DetailPrd;
  workspace: DetailWorkspace;
  revisions: RevisionEntry[];
  reviews: DetailReview[];
  activity: DetailActivity[];
  summary: DetailSummary;
}) {
  return (
    <aside className="w-full shrink-0 space-y-4 xl:w-72">
      <SidebarWidget title="Info">
        <InfoRows prd={prd} workspace={workspace} summary={summary} />
      </SidebarWidget>

      <SidebarWidget title="Revisions" maxHeight>
        <div className="space-y-3">
          {revisions.map((revision) => (
            <div key={revision.id} className="flex items-start gap-3">
              <StatusDot
                tone={
                  revision.isHead
                    ? revision.status === "done"
                      ? "done"
                      : "timeline"
                    : "timeline-muted"
                }
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      revision.isCurrentView
                        ? "text-sm font-medium text-foreground"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    Rev. {revision.revision}
                  </span>
                  {revision.isHead ? (
                    <Badge variant="current">current</Badge>
                  ) : (
                    <Badge variant="outline">superseded</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatMetaDate(revision.createdAt)}
                </div>
              </div>
              {revision.isCurrentView ? (
                <span className="text-xs text-muted-foreground">current view</span>
              ) : (
                <Link
                  to="/prds/$id"
                  params={{ id: revision.id }}
                  className="inline-flex items-center text-xs text-primary hover:underline"
                >
                  <ArrowRightIcon className="size-3" />
                </Link>
              )}
            </div>
          ))}
        </div>
      </SidebarWidget>

      {reviews.length > 0 ? (
        <SidebarWidget title="Reviews" maxHeight>
          <div className="space-y-3">
            {[...reviews].reverse().map((review, index) => (
              <ReviewItem
                key={review.id}
                review={review}
                index={reviews.length - index}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        </SidebarWidget>
      ) : null}

      <SidebarWidget title="Activity" maxHeight>
        <div className="space-y-4">
          {[...activity].reverse().map((entry, index, entries) => (
            <div key={entry.id} className="flex gap-3">
              <div className="flex w-3 shrink-0 flex-col items-center pt-1">
                <StatusDot tone={index === 0 ? "timeline" : "timeline-muted"} />
                {index < entries.length - 1 ? (
                  <div className="mt-2 flex-1 border-l border-dashed border-timeline-line" />
                ) : null}
              </div>
              <div className="pb-4">
                <p className="text-xs leading-5 text-secondary-foreground">
                  {activityLabel(entry)}
                </p>
                <p className="text-xs text-muted-foreground">{formatMetaDate(entry.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </SidebarWidget>
    </aside>
  );
}

function ReviewItem({
  review,
  index,
  defaultOpen,
}: {
  review: DetailReview;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <CollapsibleRoot
      open={open}
      onOpenChange={setOpen}
      className="border-b border-card-border pb-3 last:border-b-0 last:pb-0"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left">
          <ChevronRightIcon className="size-3 transition-transform data-[panel-open]:rotate-90" />
          <span
            data-review-id={review.id}
            className="text-sm font-semibold text-foreground hover:underline"
          >
            Review #{index}
          </span>
          <Badge variant={review.type === "human" ? "severityInfo" : "subtle"}>{review.type}</Badge>
        </CollapsibleTrigger>
        <span className="text-xs text-muted-foreground">
          {formatMetaDate(review.doneAt ?? review.createdAt)}
        </span>
      </div>
      <CollapsiblePanel>
        <div className="mt-3 space-y-3 pl-5">
          <div className="flex items-center justify-between gap-2">
            {review.status === "done" ? (
              <Badge variant="statusDone">Closed</Badge>
            ) : (
              <StatusBadge status={review.status} />
            )}
            <span className="text-xs text-muted-foreground">
              {review.findings.length} finding{review.findings.length === 1 ? "" : "s"}
            </span>
          </div>
          {review.userFeedback ? (
            <blockquote className="rounded-r-lg border-l-2 border-card-border bg-panel-muted px-3 py-2 text-xs italic leading-6 text-secondary-foreground">
              {review.userFeedback}
            </blockquote>
          ) : null}
          <div className="space-y-2">
            {review.findings.map((finding) => (
              <div key={finding.id} className="flex items-start gap-2">
                <StatusDot
                  tone={
                    finding.status === "done"
                      ? "done"
                      : finding.status === "in_progress"
                        ? "active"
                        : "pending"
                  }
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs leading-5 text-secondary-foreground">{finding.title}</p>
                  <div className="flex items-center gap-2">
                    {finding.severity ? (
                      <Badge
                        variant={
                          finding.severity === "critical"
                            ? "severityCritical"
                            : finding.severity === "major"
                              ? "severityMajor"
                              : finding.severity === "minor"
                                ? "severityMinor"
                                : "severityInfo"
                        }
                      >
                        {finding.severity}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {finding.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

function SidebarWidget({
  title,
  children,
  maxHeight,
}: {
  title: string;
  children: React.ReactNode;
  maxHeight?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      <Card
        className={`border border-card-border p-4${maxHeight ? " max-h-[420px] overflow-y-auto" : ""}`}
      >
        {children}
      </Card>
    </section>
  );
}

function InfoRows({
  prd,
  workspace,
  summary,
}: {
  prd: DetailPrd;
  workspace: DetailWorkspace;
  summary: DetailSummary;
}) {
  const displayStatus = resolvePrdDisplayStatus(prd, summary.activeReview);
  const rows = [
    ["Status", <StatusBadge key="status" status={displayStatus} />],
    [
      "Revision",
      <Badge key="revision" variant="subtle">
        v{prd.revision}
      </Badge>,
    ],
    [
      "Workspace",
      <span key="workspace" className="font-mono text-xs text-secondary-foreground">
        {workspace?.path ?? "—"}
      </span>,
    ],
    [
      "Activated",
      <span key="activated">{prd.activatedAt ? formatMetaDate(prd.activatedAt) : "never"}</span>,
    ],
    [
      prd.status === "done" ? "Completed" : prd.status === "canceled" ? "Canceled" : "Duration",
      <span key="final">{formatMetaDate(prd.updatedAt)}</span>,
    ],
    ["Audit cycles", <span key="audit">{prd.auditCycles}</span>],
    ["Phase", <span key="phase">{prd.currentPhase ?? "single-phase"}</span>],
    summary.currentCycleLabel
      ? [
          "Cycle",
          <Badge key="cycle" variant="subtle">
            {summary.currentCycleLabel}
          </Badge>,
        ]
      : null,
    summary.blockedTasks > 0
      ? [
          "Blocked tasks",
          <span key="blocked" className="text-warning-foreground">
            {summary.blockedTasks}
          </span>,
        ]
      : null,
    summary.skippedTasks > 0
      ? [
          "Skipped tasks",
          <span key="skipped" className="text-muted-foreground">
            {summary.skippedTasks}
          </span>,
        ]
      : null,
  ].filter(Boolean) as Array<[string, React.ReactNode]>;

  return (
    <div className="space-y-3">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-start justify-between gap-3 border-b border-card-border pb-3 last:border-b-0 last:pb-0"
        >
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-xs font-medium text-secondary-foreground">{value}</span>
        </div>
      ))}
    </div>
  );
}

function activityLabel(entry: DetailActivity) {
  const payload = entry.payload as Record<string, unknown>;

  switch (entry.eventType) {
    case "prd_created":
      return `PRD created — ${String(payload.title ?? "")}`;
    case "prd_ready":
      return "PRD marked ready";
    case "prd_activated":
      return "PRD activated";
    case "prd_done":
      return "PRD done — all tasks complete";
    case "prd_canceled":
      return "PRD canceled";
    case "prd_forked":
      return `PRD forked — Rev. ${String(payload.revision ?? "")}`;
    case "review_created":
      return `Review created — ${String(payload.type ?? "review")}`;
    case "review_done":
      return "Review closed";
    case "task_started":
      return `Task started — ${String(payload.title ?? "")}`;
    case "task_done":
      return `Task done — ${String(payload.title ?? "")}`;
    case "task_blocked":
      return `Task blocked — ${String(payload.title ?? "")}`;
    case "task_skipped":
      return `Task skipped — ${String(payload.title ?? "")}`;
    case "coder_progress": {
      const stage = String(payload.stage ?? "");
      const tool = payload.tool ? `[${String(payload.tool)}] ` : "";
      const msg = String(payload.message ?? "");
      const sourceTag = payload.source === "plugin" ? " (plugin)" : "";
      return `${tool}${stage}: ${msg}${sourceTag}`;
    }
    case "prd_approved": {
      const by = payload.approvedBy ? ` by ${String(payload.approvedBy)}` : "";
      return `PRD approved${by}`;
    }
    case "review_reopened":
      return "Review reopened";
    case "task_reactivated":
      return `Task reactivated — ${String(payload.title ?? "")}`;
    case "task_deleted":
      return `Task deleted — ${String(payload.title ?? "")}`;
    case "phase_advanced": {
      const to = payload.toPhase;
      return to !== undefined && to !== null
        ? `Advanced to phase ${String(to)}`
        : "Final phase complete";
    }
    default:
      return entry.eventType.replaceAll("_", " ");
  }
}
