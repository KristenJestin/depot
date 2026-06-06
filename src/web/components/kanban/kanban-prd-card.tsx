import { Link } from "@tanstack/react-router";
import {
  CalendarIcon,
  CornerDownRightIcon,
  FolderIcon,
  MilestoneIcon,
  TagIcon,
} from "lucide-react";
import type * as React from "react";

import { AgentBars } from "#/web/components/agent-bars";
import { KanbanProgressRing } from "#/web/components/kanban/kanban-progress-ring";
import { KanbanTaskList } from "#/web/components/kanban/kanban-task-list";
import { PrdPriorityBadge } from "#/web/components/prd-priority-badge";
import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import { cn } from "#/web/lib/utils";
import type { BoardCard, BoardColumn } from "#/web/lib/prd-view-model";
import { formatBoardTime, formatContextSnippet } from "#/web/lib/view-format";

export function KanbanPrdCard({
  card,
  columnId,
  showProjectBadge = false,
}: {
  card: BoardCard;
  columnId: BoardColumn["id"];
  showProjectBadge?: boolean;
}) {
  const visibleTotal = Math.max(0, card.totalTasks - card.skippedTasks);
  const progress = visibleTotal === 0 ? 0 : Math.round((card.doneTasks / visibleTotal) * 100);
  const signalBadges = buildSignalBadges(card);
  const footerLabel = resolveFooterLabel(card, columnId);
  const context = card.context ? formatContextSnippet(card.context) : (footerLabel ?? "No context");
  const isTerminal = card.status === "done" || card.status === "canceled";
  // Drop the timestamp for terminal cards — they're not "fresh" by definition
  // and the footer space is better used for the project badge in all-projects mode.
  const showTimestamp = !isTerminal;
  const showTaskList = !isTerminal;
  const showPriorityBadge = card.priority !== "normal";
  const headerHasContent =
    signalBadges.length > 0 || showPriorityBadge || (showProjectBadge && card.projectName);

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

      <div className="relative z-10 flex flex-col gap-2 px-3 pt-3 pb-2.5 pointer-events-none">
        {headerHasContent ? (
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            {showProjectBadge && card.projectName ? (
              <Badge variant="neutral" className="bg-card">
                <FolderIcon className="size-3" />
                {card.projectName}
              </Badge>
            ) : (
              <span />
            )}
            {signalBadges.length > 0 || showPriorityBadge ? (
              <div className="flex flex-wrap justify-end gap-1.5">
                {showPriorityBadge ? (
                  <PrdPriorityBadge priority={card.priority} className="bg-card" />
                ) : null}
                {signalBadges.map((badge) => (
                  <Badge key={badge.label} variant={badge.variant} className="bg-card">
                    {badge.label}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

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

        {card.targetVersion || card.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {card.targetVersion ? (
              <Badge
                variant="outline"
                className="bg-card text-[10px]"
                data-testid="milestone-badge"
                title={`Milestone ${card.targetVersion}`}
              >
                <MilestoneIcon className="size-3" />
                {card.targetVersion}
              </Badge>
            ) : null}
            {card.tags.map((tag) => (
              <Badge
                key={tag}
                variant="subtle"
                className="text-[10px]"
                data-testid="tag-badge"
                title={`Tag ${tag}`}
              >
                <TagIcon className="size-3" />
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        {showTaskList ? <KanbanTaskList card={card} /> : null}
      </div>

      <div className="border-t border-border-subtle" />

      <div className="relative z-10 flex items-center justify-between gap-2 px-3 pt-2 pb-2.5 pointer-events-none">
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
          {showTimestamp ? (
            <span className="flex items-center gap-1">
              <CalendarIcon className="size-3 text-muted-foreground" />
              <span className="font-medium text-foreground">{formatBoardTime(card.updatedAt)}</span>
            </span>
          ) : null}
          {visibleTotal > 0 ? <KanbanProgressRing value={progress} /> : null}
        </div>
      </div>
    </Card>
  );
}

type SignalBadge = {
  label: string;
  variant: React.ComponentProps<typeof Badge>["variant"];
};

// Surface only the ONE most-actionable signal per card. Stacking 3+ badges
// (critical + major + minor + blocked + skipped) was the main source of
// kanban clutter; in practice the highest-severity bucket is the
// load-bearing one — anything else only matters once the user clicks in.
function buildSignalBadges(card: BoardCard): SignalBadge[] {
  const review = card.latestReview;
  if (review?.criticalCount) {
    return [{ label: `${review.criticalCount} critical`, variant: "severityCritical" }];
  }
  if (review?.majorCount) {
    return [{ label: `${review.majorCount} major`, variant: "severityMajor" }];
  }
  if (card.blockedTasks > 0) {
    return [{ label: `${card.blockedTasks} blocked`, variant: "statusInProgress" }];
  }
  if (review?.minorCount) {
    return [{ label: `${review.minorCount} minor`, variant: "severityMinor" }];
  }
  if (review?.infoCount && !(review.criticalCount + review.majorCount + review.minorCount)) {
    return [{ label: `${review.infoCount} info`, variant: "severityInfo" }];
  }
  return [];
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
