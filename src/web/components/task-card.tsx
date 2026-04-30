import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleMinusIcon,
  CircleXIcon,
} from "lucide-react";

import { cn } from "#/web/lib/utils";
import { StatusBadge } from "#/web/components/ui/status-badge";
import type { Task } from "#/web/lib/api-types";
import type { TaskStatus } from "#/shared/validator";

type IconComponent = React.ComponentType<{ className?: string }>;

const taskStatusIcon: Record<TaskStatus, IconComponent> = {
  done: CircleCheckIcon,
  in_progress: CircleDotIcon,
  pending: CircleDashedIcon,
  blocked: CircleXIcon,
  skipped: CircleMinusIcon,
};

const taskStatusIconClass: Record<TaskStatus, string> = {
  done: "text-success",
  in_progress: "text-primary animate-pulse",
  pending: "text-muted-foreground/40",
  blocked: "text-destructive",
  skipped: "text-muted-foreground/40",
};

export function TaskCard({ task, onClick }: { task: Task; onClick?: () => void }) {
  const isDone = task.status === "done" || task.status === "skipped";
  const Icon = taskStatusIcon[task.status] ?? CircleDashedIcon;

  return (
    <div
      onClick={onClick}
      className="group bg-card border border-border hover:border-primary/50 rounded-xl p-4 transition-all cursor-pointer shadow-sm hover:shadow-md flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <Icon className={cn("size-5 shrink-0", taskStatusIconClass[task.status])} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            #{task.position}
          </span>
          <StatusBadge status={task.status} />
        </div>
        <div
          className={cn(
            "text-base font-medium truncate transition-colors",
            isDone
              ? "line-through text-muted-foreground"
              : "text-foreground group-hover:text-primary",
          )}
        >
          {task.title}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-4 mt-3 sm:mt-0 pt-3 sm:pt-0 border-t border-border sm:border-0">
        <span className="font-mono text-xs bg-secondary border border-border px-2 py-0.5 rounded text-muted-foreground">
          {task.effort}
        </span>
        <ChevronRightIcon className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-primary transition-all -translate-x-1 group-hover:translate-x-0" />
      </div>
    </div>
  );
}
