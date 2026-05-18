import * as React from "react";

import { CollapseChevron } from "#/web/components/ui/collapse-chevron";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "#/web/components/ui/collapsible";
import { TaskIndicator } from "#/web/components/ui/task-indicator";
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
    <CollapsibleRoot
      open={open}
      onOpenChange={setOpen}
      className="pointer-events-auto border-t border-card-border/70 pt-2"
    >
      <CollapsibleTrigger
        aria-controls={tasksPanelId}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        className="group flex w-full items-center justify-between gap-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>Tasks</span>
        <CollapseChevron />
      </CollapsibleTrigger>

      <CollapsiblePanel
        id={tasksPanelId}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="max-h-56 space-y-2 overflow-y-auto pt-3 pr-1">
          {visibleTasks.map((task) => (
            <KanbanTaskRow key={task.id} task={task} />
          ))}

          {skippedTasks.length > 0 ? (
            <CollapsibleRoot
              open={skippedOpen}
              onOpenChange={setSkippedOpen}
              className="border-t border-card-border pt-2"
            >
              <CollapsibleTrigger
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                className="group flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <CollapseChevron direction="right" size="sm" />
                <span>{skippedTasks.length} skipped</span>
              </CollapsibleTrigger>

              <CollapsiblePanel>
                <div className="mt-2 space-y-2">
                  {skippedTasks.map((task) => (
                    <KanbanTaskRow key={task.id} task={task} />
                  ))}
                </div>
              </CollapsiblePanel>
            </CollapsibleRoot>
          ) : null}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

function KanbanTaskRow({ task }: { task: BoardCard["previewTasks"][number] }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <TaskIndicator status={task.status} />
      <span className={taskLabelClass(task.status)}>{task.title}</span>
    </div>
  );
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
