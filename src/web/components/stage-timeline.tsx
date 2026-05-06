import { useState } from "react";
import {
  BadgeXIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleEllipsisIcon,
  CircleSlash2Icon,
  CircleStopIcon,
  ExternalLinkIcon,
} from "lucide-react";

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
} from "#/web/components/ui/accordion";
import { Badge } from "#/web/components/ui/badge";
import { Spinner } from "#/web/components/loading-overlay";
import { StatusDot } from "#/web/components/ui/status-dot";
import type { StageCard, StageItem } from "#/web/lib/prd-view-model";
import { formatMetaDate } from "#/web/lib/view-format";

export function StageTimeline({ cards }: { cards: StageCard[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Tasks</p>
      <div className="space-y-3">
        {cards.map((card, index) => (
          <StageCardView key={card.id} card={card} isLast={index === cards.length - 1} />
        ))}
      </div>
    </div>
  );
}

function StageCardView({ card, isLast }: { card: StageCard; isLast: boolean }) {
  const inProgressTasks = card.items.filter((t) => t.status === "in_progress");
  const skippedTasks = card.items.filter((t) => t.status === "skipped");
  const otherTasks = card.items.filter((t) => t.status !== "in_progress" && t.status !== "skipped");

  const visibleCount = card.items.filter((t) => t.status !== "skipped").length;
  const meta = rebuildMeta(card, visibleCount);

  return (
    <div className="flex gap-4">
      <div className="flex w-3 shrink-0 flex-col items-center pt-4">
        <StatusDot tone={card.current ? (card.complete ? "done" : "timeline") : "timeline-muted"} />
        {!isLast ? (
          <div className="mt-2 flex-1 border-l border-dashed border-timeline-line" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <AccordionRoot defaultValue={card.current ? [card.id] : []}>
          <AccordionItem value={card.id}>
            <AccordionHeader>
              <AccordionTrigger
                trailing={
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{meta}</span>
                    {card.kind === "review" && card.review ? (
                      <span
                        data-review-id={card.review.id}
                        role="button"
                        tabIndex={0}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLinkIcon className="size-3" />
                        details
                      </span>
                    ) : null}
                  </span>
                }
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span>{card.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{meta}</div>
                </div>
              </AccordionTrigger>
            </AccordionHeader>

            {inProgressTasks.length > 0 ? (
              <div className="space-y-2 px-4 pt-2 pb-1">
                {inProgressTasks.map((item) => (
                  <StageTimelineItem key={item.id} item={item} />
                ))}
              </div>
            ) : null}

            <AccordionPanel>
              <div className="space-y-4 p-4">
                {card.review?.userFeedback ? (
                  <blockquote className="rounded-r-lg border-l-2 border-card-border bg-panel-muted px-3 py-2 text-sm italic text-secondary-foreground">
                    {card.review.userFeedback}
                  </blockquote>
                ) : null}

                <div className="max-h-105 space-y-3 overflow-y-auto pr-1">
                  {otherTasks.map((item) => (
                    <StageTimelineItem key={item.id} item={item} />
                  ))}
                </div>

                {skippedTasks.length > 0 ? <SkippedSection items={skippedTasks} /> : null}
              </div>
            </AccordionPanel>
          </AccordionItem>
        </AccordionRoot>
      </div>
    </div>
  );
}

function SkippedSection({ items }: { items: StageItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-card-border pt-3">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRightIcon
          className={["size-3 transition-transform", open ? "rotate-90" : ""].join(" ")}
        />
        <span>{items.length} skipped</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          {items.map((item) => (
            <StageTimelineItem key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function rebuildMeta(card: StageCard, visibleCount: number): string {
  const visible = card.items.filter((t) => t.status !== "skipped");
  const doneCount = visible.filter((t) => t.status === "done").length;
  const skippedCount = card.items.length - visible.length;

  if (card.canceled) {
    return `${doneCount} / ${visibleCount} done · canceled`;
  }
  const base = `${doneCount} / ${visibleCount} done`;
  return skippedCount > 0 ? `${base} · ${skippedCount} skipped` : base;
}

function StageTimelineItem({ item }: { item: StageItem }) {
  return (
    <button
      type="button"
      data-task-id={item.id}
      className="flex w-full items-start gap-3 border-b border-card-border pb-3 text-left transition-colors hover:bg-panel-muted last:border-b-0 last:pb-0"
    >
      <StatusDot tone={mapItemTone(item.status)} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className={itemTitleClass(item.status)}>{item.title}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="subtle">{item.effort}</Badge>
              {item.severity ? (
                <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
              ) : null}
              {item.status === "blocked" ? <Badge variant="statusInProgress">blocked</Badge> : null}
              {item.status === "skipped" ? <Badge variant="outline">skipped</Badge> : null}
              {item.status === "stopped" ? <Badge variant="outline">stopped</Badge> : null}
              {timestampLabel(item) ? (
                <span className="text-xs text-muted-foreground">{timestampLabel(item)}</span>
              ) : null}
            </div>
            {item.status === "blocked" && item.blockedReason ? (
              <p className="text-xs italic text-warning-foreground">{item.blockedReason}</p>
            ) : null}
            {item.status === "skipped" && item.skipReason ? (
              <p className="text-xs italic text-muted-foreground">{item.skipReason}</p>
            ) : null}
            {item.status === "stopped" ? (
              <p className="text-xs italic text-muted-foreground">
                Agent was working on this task when the PRD was canceled
              </p>
            ) : null}
          </div>

          <div className="shrink-0 pt-0.5 text-muted-foreground">{itemIndicator(item.status)}</div>
        </div>
      </div>
    </button>
  );
}

function itemIndicator(status: StageItem["status"]) {
  if (status === "done") {
    return <CircleCheckIcon className="size-4 text-success" />;
  }

  if (status === "in_progress") {
    return <Spinner className="size-4" />;
  }

  if (status === "blocked") {
    return <BadgeXIcon className="size-4 text-warning" />;
  }

  if (status === "skipped") {
    return <CircleSlash2Icon className="size-4 text-task-skipped" />;
  }

  if (status === "stopped") {
    return <CircleStopIcon className="size-4 text-task-stopped" />;
  }

  return <CircleEllipsisIcon className="size-4 text-task-pending" />;
}

function itemTitleClass(status: StageItem["status"]) {
  if (status === "done") {
    return "text-sm leading-6 text-muted-foreground line-through";
  }

  if (status === "in_progress") {
    return "text-sm font-semibold leading-6 text-foreground";
  }

  if (status === "blocked") {
    return "text-sm font-medium leading-6 text-warning-foreground";
  }

  if (status === "skipped" || status === "stopped") {
    return "text-sm leading-6 text-muted-foreground line-through";
  }

  return "text-sm leading-6 text-muted-foreground";
}

function mapItemTone(status: StageItem["status"]) {
  if (status === "done") {
    return "done" as const;
  }

  if (status === "in_progress") {
    return "active" as const;
  }

  if (status === "blocked") {
    return "blocked" as const;
  }

  if (status === "skipped") {
    return "skipped" as const;
  }

  if (status === "stopped") {
    return "stopped" as const;
  }

  return "pending" as const;
}

function severityVariant(severity: NonNullable<StageItem["severity"]>) {
  if (severity === "critical") {
    return "severityCritical" as const;
  }

  if (severity === "major") {
    return "severityMajor" as const;
  }

  if (severity === "minor") {
    return "severityMinor" as const;
  }

  return "severityInfo" as const;
}

function timestampLabel(item: StageItem) {
  if (item.status === "done" || item.status === "skipped") {
    return formatMetaDate(item.completedAt);
  }

  if (item.status === "in_progress") {
    return item.startedAt ? `ongoing · ${formatMetaDate(item.startedAt)}` : "ongoing";
  }

  return null;
}
