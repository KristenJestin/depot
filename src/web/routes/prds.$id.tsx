import * as React from "react";
import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { prdsQuery } from "../lib/queries";
import type { Task } from "../lib/api-types";
import { relativeDate } from "../lib/format";
import { StatusBadge } from "../components/ui/status-badge";
import { DotLoader } from "../components/ui/dot-loader";
import { FindingsPanel, FindingRow } from "../components/findings-panel";
import { TaskDetail } from "../components/task-detail";
import { cn } from "../lib/utils";
import type { TaskStatus } from "#/shared/validator";

const TASK_FILTERS = ["all", "todo", "done"] as const;
type TaskFilter = (typeof TASK_FILTERS)[number];

export const Route = createFileRoute("/prds/$id")({
  loader: async ({ params }) => {
    const data = await prdsQuery.detail.ensureQueryData(params.id);
    if (!data?.prd) throw notFound();
    return data;
  },
  pendingComponent: () => (
    <div className="flex items-center justify-center h-full">
      <DotLoader preset="thinking" label="Loading…" />
    </div>
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();
  const { data } = prdsQuery.detail.useSuspense(id);
  const { prd, tasks, review } = data;

  const [activeTask, setActiveTask] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<TaskFilter>("all");
  const [showFindings, setShowFindings] = React.useState(false);

  const doneTasks = tasks.filter((t) => t.status === "done");
  const pct = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  const filtered = tasks.filter((t) => {
    if (filter === "todo") return ["pending", "in_progress", "blocked"].includes(t.status);
    if (filter === "done") return ["done", "skipped"].includes(t.status);
    return true;
  });

  const findings = review?.findings ?? [];
  const circumference = 2 * Math.PI * 22;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      {/* TopBar */}
      <header className="flex items-center justify-between shrink-0 h-11 px-6 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/" className="text-xs text-muted-foreground no-underline shrink-0">
            PRDs /
          </Link>
          <span className="font-semibold truncate text-sm max-w-sm">{prd.title}</span>
          <StatusBadge status={prd.status} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {tasks.length > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              {doneTasks.length}/{tasks.length} tasks
            </span>
          )}
          {findings.length > 0 && (
            <button
              onClick={() => setShowFindings(true)}
              className="text-xs text-chart-4 bg-chart-4/10 border border-chart-4/25 px-2 py-0.5 rounded cursor-pointer"
            >
              View {findings.length} findings
            </button>
          )}
        </div>
      </header>

      {/* 3-column grid */}
      <div className="flex-1 overflow-hidden grid grid-cols-[260px_1fr_280px]">
        {/* COL 1 — Tasks */}
        <div className="flex flex-col overflow-hidden border-r border-border">
          <div className="shrink-0 pt-2.5 pb-1">
            <div className="flex items-center justify-between px-3 mb-0.5 text-xs text-muted-foreground font-medium">
              <span>
                Tasks
                <span className="font-mono text-2xs ml-1">
                  · {doneTasks.length}/{tasks.length}
                </span>
              </span>
            </div>
            {tasks.length > 0 && (
              <div className="px-3 pb-1.5 pt-0.5">
                <div className="h-0.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct}%`, transition: "width 1s ease" }}
                  />
                </div>
              </div>
            )}
            <div className="flex gap-0.5 px-3 pb-1 pt-0.5">
              {TASK_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f);
                    setActiveTask(null);
                  }}
                  className={cn(
                    "text-xs font-medium px-1.5 py-0.5 bg-transparent border-none cursor-pointer transition-colors",
                    filter === f
                      ? "text-foreground border-b border-primary"
                      : "text-muted-foreground border-b border-transparent",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto flex-1 pb-4">
            {tasks.length === 0 && (
              <div className="px-4 py-6 text-center">
                <div className="text-xs text-muted-foreground">No tasks defined</div>
              </div>
            )}
            {filtered.map((task) => (
              <div key={task.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md transition-colors cursor-pointer px-2.5 py-1",
                    activeTask === task.id ? "bg-accent" : "bg-transparent",
                  )}
                  onClick={() => setActiveTask(activeTask === task.id ? null : task.id)}
                >
                  <StatusSq status={task.status as TaskStatus} />
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    #{task.position}
                  </span>
                  <span
                    className={cn(
                      "flex-1 min-w-0 truncate text-xs leading-snug",
                      (task.status === "done" || task.status === "skipped") &&
                        "line-through opacity-40",
                    )}
                  >
                    {task.title}
                  </span>
                  <span className="font-mono text-2xs px-1.5 py-px rounded text-muted-foreground bg-secondary border border-border/60 shrink-0">
                    {task.effort}
                  </span>
                  <ChevronRight
                    className={cn(
                      "size-2.5 text-muted-foreground shrink-0 transition-transform duration-150",
                      activeTask === task.id && "rotate-90",
                    )}
                  />
                </div>
                {task.blockedReason && (
                  <div className="px-2.5 pb-1 pl-10">
                    <span className="font-mono text-2xs text-chart-4 leading-snug">
                      {task.blockedReason}
                    </span>
                  </div>
                )}
                {activeTask === task.id && <TaskDetail task={task as Task} />}
              </div>
            ))}
          </div>
        </div>

        {/* COL 2 — Content */}
        <div className="overflow-y-auto border-r border-border">
          <div className="pt-2.5">
            <SLabel>Context</SLabel>
            {prd.context && (
              <p className="text-xs text-muted-foreground leading-relaxed px-4 pb-3 pt-1">
                {prd.context}
              </p>
            )}
          </div>
          {prd.scope && (
            <>
              <Divider />
              <div>
                <SLabel>Scope</SLabel>
                <p className="text-xs text-muted-foreground leading-relaxed px-4 pb-3 pt-1">
                  {prd.scope}
                </p>
              </div>
            </>
          )}
          {tasks.length > 0 && (
            <div className="px-4 pb-4 pt-2">
              <Divider />
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs text-muted-foreground font-medium">Tasks progress</span>
                <span className="font-mono text-xs">{pct}%</span>
              </div>
              <div className="h-0.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${pct}%`, transition: "width 1s ease" }}
                />
              </div>
            </div>
          )}
        </div>

        {/* COL 3 — Metadata */}
        <div className="overflow-y-auto">
          <div className="pt-2.5 pb-2">
            <SLabel>Details</SLabel>
            <KVRow label="Status" value={prd.status} mono={false} />
            <KVRow label="Revision" value={`r${prd.revision}`} mono />
            {tasks.length > 0 && (
              <KVRow label="Effort" value={tasks.map((t) => t.effort).join(" · ")} mono />
            )}
            {prd.createdAt && (
              <KVRow
                label="Created"
                value={relativeDate(prd.createdAt as unknown as number) ?? ""}
                mono={false}
              />
            )}
            {prd.activatedAt && (
              <KVRow
                label="Activated"
                value={relativeDate(prd.activatedAt as unknown as number) ?? ""}
                mono={false}
              />
            )}
          </div>

          {tasks.length > 0 && (
            <>
              <Divider />
              <div className="px-3 pt-2 pb-3">
                <div className="flex items-center gap-4 px-1">
                  <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0 -rotate-90">
                    <circle
                      cx="28"
                      cy="28"
                      r="22"
                      fill="none"
                      stroke="var(--color-border)"
                      strokeWidth="3"
                    />
                    <circle
                      cx="28"
                      cy="28"
                      r="22"
                      fill="none"
                      stroke="var(--color-primary)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference - (circumference * pct) / 100}
                      style={{ transition: "stroke-dashoffset 1s ease" }}
                    />
                  </svg>
                  <div>
                    <div className="text-2xl font-semibold leading-none">{pct}%</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {doneTasks.length} of {tasks.length} done
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {review && (
            <>
              <Divider />
              <div className="pt-2 pb-1">
                <div className="flex items-center justify-between px-3 mb-0.5 text-xs text-muted-foreground font-medium">
                  <span className="flex items-center gap-1.5">
                    Review
                    <span
                      className={cn(
                        "font-mono text-2xs px-1 py-px rounded-sm",
                        review.type === "human"
                          ? "text-chart-3 bg-chart-3/12"
                          : "text-chart-2 bg-chart-2/12",
                      )}
                    >
                      {review.type}
                    </span>
                  </span>
                  {findings.length > 0 && (
                    <button
                      onClick={() => setShowFindings(true)}
                      className="text-2xs text-primary bg-transparent border-none cursor-pointer"
                    >
                      {findings.length} findings
                    </button>
                  )}
                </div>
                {findings.length === 0 ? (
                  <div className="px-3 py-2">
                    <span className="text-xs text-muted-foreground">No findings</span>
                  </div>
                ) : (
                  <div className="px-3 pb-2 pt-1">
                    {findings.slice(0, 2).map((f, i) => (
                      <FindingRow key={i} finding={f} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showFindings && <FindingsPanel findings={findings} onClose={() => setShowFindings(false)} />}
    </div>
  );
}

// ── Inline sub-components ─────────────────────────────────────────────────────

function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground font-medium px-3 mb-0.5 py-1">{children}</div>
  );
}

function Divider() {
  return <div className="h-px bg-border/60 mb-2" />;
}

function KVRow({ label, value, mono }: { label: string; value: string; mono: boolean }) {
  return (
    <div className="flex items-baseline gap-2 px-3 py-1 text-xs">
      <span className="text-xs text-muted-foreground min-w-18 shrink-0">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

function StatusSq({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "size-2 rounded-sm shrink-0",
        status === "done" && "bg-chart-5",
        status === "in_progress" && "bg-primary ring-2 ring-primary/20",
        status === "blocked" && "bg-chart-4",
        status === "skipped" && "bg-muted-foreground opacity-30",
        status !== "done" &&
          status !== "in_progress" &&
          status !== "blocked" &&
          status !== "skipped" &&
          "bg-transparent border border-border",
      )}
    />
  );
}
