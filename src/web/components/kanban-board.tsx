import { Link } from "@tanstack/react-router";

import { AgentBars } from "#/web/components/agent-bars";
import { PrdStatusIcon } from "#/web/components/prd-status-icon";
import { Card } from "#/web/components/ui/card";
import { ProgressBar } from "#/web/components/ui/progress";
import { StatusDot } from "#/web/components/ui/status-dot";
import type { BoardCard, BoardColumn } from "#/web/lib/prd-view-model";
import { formatBoardTime, formatContextSnippet } from "#/web/lib/view-format";

export function KanbanBoard({ columns }: { columns: BoardColumn[] }) {
  return (
    <div className="overflow-x-auto px-6 pb-10 pt-5">
      <div className="flex min-w-max items-start gap-4">
        {columns.map((column) => (
          <section key={column.id} className="w-60 shrink-0">
            <header className="mb-4 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <PrdStatusIcon status={column.id === "review" ? "review" : column.id} />
                <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {column.title}
                </h2>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {column.cards.length}
              </span>
            </header>

            <div className="space-y-3">
              {column.cards.map((card) => (
                <KanbanCard key={card.id} card={card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function KanbanCard({ card }: { card: BoardCard }) {
  const progress = card.totalTasks === 0 ? 0 : Math.round((card.doneTasks / card.totalTasks) * 100);

  return (
    <Link to="/prds/$id" params={{ id: card.id }} className="block no-underline">
      <Card
        className={[
          "transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-card-hover",
          card.status === "canceled" ? "opacity-70" : undefined,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <h3
              className={[
                "text-sm font-semibold leading-6 text-foreground",
                card.status === "canceled" ? "text-muted-foreground line-through" : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {card.title}
            </h3>
            <p className="text-xs text-muted-foreground">{card.footerLabel}</p>
          </div>

          {card.context && (
            <p className="text-sm leading-6 text-muted-foreground">
              {formatContextSnippet(card.context)}
            </p>
          )}

          {card.latestReview && columnNeedsReviewMeta(card) && (
            <p className="text-xs text-muted-foreground">
              {card.latestReview.majorCount > 0 ? `${card.latestReview.majorCount} major` : null}
              {card.latestReview.minorCount > 0
                ? `${card.latestReview.majorCount > 0 ? " · " : ""}${card.latestReview.minorCount} minor`
                : null}
            </p>
          )}

          {card.totalTasks > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {card.doneTasks} / {card.totalTasks} tasks
                </span>
              </div>
              <ProgressBar value={progress} />
            </div>
          )}

          {card.previewTasks.length > 0 && (
            <div className="space-y-2 border-t border-card-border pt-3">
              {card.previewTasks.map((task, index) => (
                <div key={task.id} className="flex items-start gap-2 text-xs">
                  <StatusDot
                    tone={mapTaskTone(task.status)}
                    className={index === 0 ? "" : undefined}
                  />
                  <span className={taskLabelClass(task.status)}>{task.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Card.Footer className="mt-0 border-card-border px-4 py-3 text-xs text-muted-foreground">
          {card.animatedLabel ? (
            <span className="flex items-center gap-2 text-status-in-progress-foreground">
              <AgentBars />
              <span>{card.animatedLabel}</span>
            </span>
          ) : (
            <span>{formatBoardTime(card.updatedAt)}</span>
          )}
          <span className="ml-auto">{formatBoardTime(card.updatedAt)}</span>
        </Card.Footer>
      </Card>
    </Link>
  );
}

function columnNeedsReviewMeta(card: BoardCard) {
  return (
    card.latestReview && (card.latestReview.majorCount > 0 || card.latestReview.minorCount > 0)
  );
}

function mapTaskTone(status: BoardCard["previewTasks"][number]["status"]) {
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

  return "pending" as const;
}

function taskLabelClass(status: BoardCard["previewTasks"][number]["status"]) {
  if (status === "done") {
    return "line-through text-muted-foreground";
  }

  if (status === "in_progress") {
    return "font-medium text-foreground";
  }

  if (status === "blocked") {
    return "font-medium text-warning-foreground";
  }

  if (status === "skipped") {
    return "line-through text-muted-foreground";
  }

  return "text-muted-foreground";
}
