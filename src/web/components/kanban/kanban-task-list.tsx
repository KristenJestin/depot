import * as React from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { StatusDot } from "#/web/components/ui/status-dot";
import { cn } from "#/web/lib/utils";
import type { BoardCard } from "#/web/lib/prd-view-model";

export function KanbanTaskList({ card }: { card: BoardCard }) {
  const [open, setOpen] = React.useState(false);
  const [skippedOpen, setSkippedOpen] = React.useState(false);
  const visibleTasks = card.previewTasks.filter((task) => task.status !== "skipped");
  const skippedTasks = card.previewTasks.filter((task) => task.status === "skipped");
  const tasksPanelId = `kanban-tasks-${card.id}`;

  if (visibleTasks.length === 0 && skippedTasks.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-auto border-t border-card-border/70 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={tasksPanelId}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex w-full items-center justify-between gap-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>Tasks</span>
        <ChevronDownIcon
          className={cn("size-4 transition-transform", open ? "rotate-180" : undefined)}
        />
      </button>

      {open ? (
        <div id={tasksPanelId} className="max-h-56 space-y-2 overflow-y-auto pt-3 pr-1">
          {visibleTasks.map((task) => (
            <KanbanTaskRow key={task.id} task={task} />
          ))}

          {skippedTasks.length > 0 ? (
            <div className="border-t border-card-border pt-2">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSkippedOpen((value) => !value);
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRightIcon
                  className={cn("size-3 transition-transform", skippedOpen ? "rotate-90" : null)}
                />
                <span>{skippedTasks.length} skipped</span>
              </button>

              {skippedOpen ? (
                <div className="mt-2 space-y-2">
                  {skippedTasks.map((task) => (
                    <KanbanTaskRow key={task.id} task={task} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function KanbanTaskRow({ task }: { task: BoardCard["previewTasks"][number] }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <StatusDot tone={mapTaskTone(task.status)} />
      <span className={taskLabelClass(task.status)}>{task.title}</span>
    </div>
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
