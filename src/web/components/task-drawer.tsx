import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Badge } from "#/web/components/ui/badge";
import { TaskDetail } from "#/web/components/task-detail";
import type { PrdRepoSummary } from "#/web/components/prd-repos-widget";
import { TaskRepoSelector } from "#/web/components/task-repo-selector";
import { StatusBadge } from "#/web/components/ui/status-badge";
import {
  SideDrawer,
  SideDrawerCloseButton,
  SideDrawerTitle,
} from "#/web/components/ui/side-drawer";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import { formatMetaDate } from "#/web/lib/view-format";

type DetailTask =
  | PrdDetailResponse["tasks"][number]
  | PrdDetailResponse["reviews"][number]["findings"][number];
type DetailReview = PrdDetailResponse["reviews"][number];

type PrdReposResponse = {
  items: PrdRepoSummary[];
  projectRepos: PrdRepoSummary[];
  implicit: boolean;
};

export function TaskDrawer({
  task,
  open,
  reviews,
  allTasks,
  onClose,
}: {
  task: DetailTask | null;
  open: boolean;
  reviews: DetailReview[];
  allTasks: Array<DetailTask>;
  onClose: () => void;
}) {
  if (!task) {
    return (
      <SideDrawer open={open} onOpenChange={(o) => !o && onClose()} ariaLabel="Task">
        <div />
      </SideDrawer>
    );
  }

  const dependencyIds = parseDependsOn(task.dependsOn);
  const dependencies = dependencyIds
    .map((id) => allTasks.find((candidate) => candidate.id === id))
    .filter(Boolean) as DetailTask[];
  const review = task.reviewId ? reviews.find((candidate) => candidate.id === task.reviewId) : null;

  return (
    <SideDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      ariaLabel={`Task: ${task.title}`}
    >
      <header className="flex items-start justify-between gap-4 border-b border-card-border px-6 py-5">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Task
          </p>
          <SideDrawerTitle className="text-xl font-semibold text-foreground">
            {task.title}
          </SideDrawerTitle>
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
        <SideDrawerCloseButton />
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

        <TaskRepoEditor task={task} />

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
    </SideDrawer>
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

function TaskRepoEditor({ task }: { task: DetailTask }) {
  const queryClient = useQueryClient();
  const prdRevisionId = task.prdRevisionId;
  const [error, setError] = useState<string | null>(null);
  const key = ["prds", prdRevisionId, "repos"] as const;

  const reposQ = useQuery({
    queryKey: key,
    queryFn: async (): Promise<PrdReposResponse> => {
      const res = await fetch(`/api/prds/${prdRevisionId}/repos`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PrdReposResponse;
    },
  });

  const updateM = useMutation({
    mutationFn: async (repoId: string | null) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdRevisionId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["prds", prdRevisionId] });
    },
  });

  // Reset the surfaced error when the user opens a different task.
  useEffect(() => {
    setError(null);
  }, [task.id]);

  if (!reposQ.data) return null;

  // Mono-repo (no project_repo registered): the repo selector is not
  // applicable — the task always carries `repoId = null` by construction.
  if (reposQ.data.implicit) return null;

  return (
    <section className="space-y-3 rounded-xl border border-card-border bg-card p-5 shadow-card">
      <h3 className="text-sm font-semibold text-foreground">Repo</h3>
      <TaskRepoSelector
        currentRepoId={task.repoId ?? null}
        prdRepos={reposQ.data.items}
        onChange={(repoId) => updateM.mutate(repoId)}
        error={error}
        disabled={updateM.isPending}
      />
    </section>
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
