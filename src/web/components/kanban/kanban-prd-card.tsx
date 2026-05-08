import { Link } from "@tanstack/react-router";
import { CalendarIcon, CornerDownRightIcon, ListChecksIcon, MessageCircleIcon } from "lucide-react";
import type * as React from "react";

import { AgentBars } from "#/web/components/agent-bars";
import { Spinner } from "#/web/components/loading-overlay";
import { KanbanProgressRing } from "#/web/components/kanban/kanban-progress-ring";
import { KanbanTaskList } from "#/web/components/kanban/kanban-task-list";
import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import { StatusDot } from "#/web/components/ui/status-dot";
import { cn } from "#/web/lib/utils";
import type { BoardCard, BoardColumn } from "#/web/lib/prd-view-model";
import { formatBoardTime, formatContextSnippet } from "#/web/lib/view-format";

export function KanbanPrdCard({
  card,
  columnId,
}: {
  card: BoardCard;
  columnId: BoardColumn["id"];
}) {
  const visibleTotal = Math.max(0, card.totalTasks - card.skippedTasks);
  const progress = visibleTotal === 0 ? 0 : Math.round((card.doneTasks / visibleTotal) * 100);
  const activeTasks = card.previewTasks.filter((task) => task.status === "in_progress");
  const signalBadges = buildSignalBadges(card);
  const footerLabel = resolveFooterLabel(card, columnId);
  const context = card.context ? formatContextSnippet(card.context) : (footerLabel ?? "No context");
  const showTimestamp = card.status !== "done";

  return (
    <Card
      className={cn(
        "relative gap-0 overflow-hidden py-0 shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover",
        "focus-within:ring-2 focus-within:ring-ring/20",
        card.status === "canceled" ? "opacity-70" : null,
      )}
    >
      <Link
        to="/prds/$id"
        params={{ id: card.id }}
        aria-label={`Open ${card.title}`}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="relative z-10 flex flex-col gap-2.5 px-3 pt-3 pb-2.5 pointer-events-none">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className="bg-card">
            <ListChecksIcon className="size-3" />
            {visibleTotal}
          </Badge>
          <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
            {signalBadges.map((badge) => (
              <Badge key={badge.label} variant={badge.variant} className="bg-card">
                {badge.label}
              </Badge>
            ))}
          </div>
        </div>

        <p
          className={cn(
            "truncate text-sm font-medium text-foreground",
            card.status === "canceled" ? "text-muted-foreground line-through" : null,
          )}
        >
          {card.title}
        </p>

        <div className="flex items-start gap-1.5">
          <CornerDownRightIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <p className="truncate text-xs text-muted-foreground">{context}</p>
        </div>

        {activeTasks.length > 0 ? (
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 rounded-md border border-card-border bg-card px-2 py-1.5 text-xs"
              >
                <StatusDot tone="active" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {task.title}
                </span>
                <Spinner />
              </div>
            ))}
          </div>
        ) : null}

        <KanbanTaskList card={card} />
      </div>

      <div className="border-t border-border-subtle" />

      <div className="relative z-10 flex items-center justify-between gap-2 px-3 pt-2.5 pb-3 pointer-events-none">
        <div className="min-w-0 flex items-center gap-2 text-xs text-muted-foreground">
          {card.animatedLabel ? (
            <span className="flex min-w-0 items-center gap-2 text-status-in-progress-foreground">
              <AgentBars />
              <span className="truncate">{card.animatedLabel}</span>
            </span>
          ) : footerLabel ? (
            <span className="truncate">{footerLabel}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <MessageCircleIcon className="size-3 text-muted-foreground" />
            <span className="font-medium text-foreground">
              {card.latestReview?.findingsCount ?? 0}
            </span>
          </span>
          {showTimestamp ? (
            <span className="flex items-center gap-1">
              <CalendarIcon className="size-3 text-muted-foreground" />
              <span className="font-medium text-foreground">{formatBoardTime(card.updatedAt)}</span>
            </span>
          ) : null}
          <KanbanProgressRing value={progress} />
        </div>
      </div>
    </Card>
  );
}

type SignalBadge = {
  label: string;
  variant: React.ComponentProps<typeof Badge>["variant"];
};

function buildSignalBadges(card: BoardCard): SignalBadge[] {
  const badges: SignalBadge[] = [];
  const review = card.latestReview;

  if (review) {
    if (review.criticalCount > 0) {
      badges.push({ label: `${review.criticalCount} critical`, variant: "severityCritical" });
    }
    if (review.majorCount > 0) {
      badges.push({ label: `${review.majorCount} major`, variant: "severityMajor" });
    }
    if (review.minorCount > 0) {
      badges.push({ label: `${review.minorCount} minor`, variant: "severityMinor" });
    }
    if (
      review.infoCount > 0 &&
      review.criticalCount + review.majorCount + review.minorCount === 0
    ) {
      badges.push({ label: `${review.infoCount} info`, variant: "severityInfo" });
    }
  }

  if (card.blockedTasks > 0) {
    badges.push({ label: `${card.blockedTasks} blocked`, variant: "statusInProgress" });
  }

  if (card.skippedTasks > 0) {
    badges.push({ label: `${card.skippedTasks} skipped`, variant: "outline" });
  }

  return badges.slice(0, 3);
}

function resolveFooterLabel(card: BoardCard, columnId: BoardColumn["id"]): string | null {
  const normalizedFooter = normalizeLabel(card.footerLabel);
  const columnStatus = columnId === "review" ? "review" : columnId;
  const redundantLabels = new Set([
    normalizeLabel(columnId),
    normalizeLabel(columnStatus),
    normalizeLabel(columnTitle(columnId)),
    normalizeLabel(card.status),
    normalizeLabel(card.status.replace("_", " ")),
  ]);

  if (columnId === "done") {
    redundantLabels.add("completed");
  }

  if (columnId === "canceled") {
    redundantLabels.add("cancelled");
  }

  if (redundantLabels.has(normalizedFooter)) {
    return null;
  }

  return card.footerLabel;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").trim();
}

function columnTitle(columnId: BoardColumn["id"]): string {
  if (columnId === "ready") {
    return "Todo";
  }

  if (columnId === "in_progress") {
    return "In Progress";
  }

  return columnId;
}
