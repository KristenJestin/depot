import { XIcon } from "lucide-react";

import { Badge } from "#/web/components/ui/badge";
import { TaskDetail } from "#/web/components/task-detail";
import { StatusBadge } from "#/web/components/ui/status-badge";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import { formatMetaDate } from "#/web/lib/view-format";

type DetailTask =
  | PrdDetailResponse["tasks"][number]
  | PrdDetailResponse["reviews"][number]["findings"][number];
type DetailReview = PrdDetailResponse["reviews"][number];

export function TaskDrawer({
  task,
  reviews,
  allTasks,
  onClose,
}: {
  task: DetailTask;
  reviews: DetailReview[];
  allTasks: Array<DetailTask>;
  onClose: () => void;
}) {
  const dependencyIds = parseDependsOn(task.dependsOn);
  const dependencies = dependencyIds
    .map((id) => allTasks.find((candidate) => candidate.id === id))
    .filter(Boolean) as DetailTask[];
  const review = task.reviewId ? reviews.find((candidate) => candidate.id === task.reviewId) : null;

  return (
    <div className="pointer-events-auto fixed inset-y-0 right-0 z-40 flex w-full max-w-xl">
      <div className="flex-1 bg-background/10" onClick={onClose} />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-card-border bg-card shadow-card-hover">
        <header className="flex items-start justify-between gap-4 border-b border-card-border px-6 py-5">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Task
            </p>
            <h2 className="text-xl font-semibold text-foreground">{task.title}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <Badge variant="subtle">{task.effort}</Badge>
              {task.severity ? (
                <Badge
                  variant={
                    task.severity === "critical"
                      ? "severityCritical"
                      : task.severity === "major"
                        ? "severityMajor"
                        : task.severity === "minor"
                          ? "severityMinor"
                          : "severityInfo"
                  }
                >
                  {task.severity}
                </Badge>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close task drawer"
          >
            <XIcon className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <TaskDetail task={task} />

          <section className="space-y-3 rounded-xl border border-card-border bg-card p-5 shadow-card">
            <h3 className="text-sm font-semibold text-foreground">Details</h3>
            <div className="space-y-3 text-sm">
              <MetaRow label="Created" value={formatMetaDate(task.createdAt)} />
              <MetaRow
                label="Started"
                value={task.startedAt ? formatMetaDate(task.startedAt) : "—"}
              />
              <MetaRow
                label="Completed"
                value={task.completedAt ? formatMetaDate(task.completedAt) : "—"}
              />
              <MetaRow label="Status" value={<StatusBadge status={task.status} />} />
              <MetaRow label="Effort" value={<Badge variant="subtle">{task.effort}</Badge>} />
              <MetaRow label="Review" value={review ? `${review.type} review` : "—"} />
            </div>
          </section>

          {dependencies.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-card-border bg-card p-5 shadow-card">
              <h3 className="text-sm font-semibold text-foreground">Dependencies</h3>
              <div className="space-y-2">
                {dependencies.map((dependency) => (
                  <div
                    key={dependency.id}
                    className="flex items-start gap-2 text-sm text-secondary-foreground"
                  >
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-task-done" />
                    <span
                      className={
                        dependency.status === "done" || dependency.status === "skipped"
                          ? "line-through text-muted-foreground"
                          : undefined
                      }
                    >
                      {dependency.title}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-card-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-secondary-foreground">{value}</span>
    </div>
  );
}

function parseDependsOn(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}
