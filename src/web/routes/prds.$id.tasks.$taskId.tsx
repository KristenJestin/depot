import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { tasksQuery } from "../lib/queries";
import { relativeDate } from "../lib/format";
import { StatusBadge } from "../components/ui/status-badge";
import { Terminal, TerminalLine } from "../components/ui/terminal";
import { FileChangeList } from "../components/file-change-list";
import { TaskDetail } from "../components/task-detail";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";

export const Route = createFileRoute("/prds/$id/tasks/$taskId")({
  loader: async ({ params }) => {
    try {
      await tasksQuery.detail.ensureQueryData(params.id, params.taskId);
    } catch {
      throw notFound();
    }
  },
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id, taskId } = Route.useParams();
  const { data } = tasksQuery.detail.useSuspense(id, taskId);
  const { task, prd, activity } = data;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-10 flex flex-col gap-8 max-w-screen-2xl mx-auto">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="hover:text-foreground transition-colors">
                Dashboard
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link
                to="/prds/$id"
                params={{ id: prd.id }}
                className="hover:text-foreground transition-colors font-mono"
              >
                {prd.id}
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-mono">#{task.position}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            #{task.position}
            {" · "}
            <span className="font-mono text-xs bg-secondary border border-border px-2 py-0.5 rounded">
              {task.effort}
            </span>
            {" · "}
            <Link to="/prds/$id" params={{ id: prd.id }} className="text-primary hover:underline">
              {prd.title}
            </Link>
          </p>
        </div>

        {/* Overview */}
        <div className="space-y-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Overview</p>
          <TaskDetail task={task} />
          {task.blockedReason && (
            <div className="bg-card border border-destructive/30 rounded-xl p-5">
              <h4 className="font-semibold text-sm mb-3 text-destructive">Blocked</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{task.blockedReason}</p>
            </div>
          )}
        </div>

        {/* Activity */}
        <div className="space-y-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Activity</p>
          <Terminal
            label={`task #${task.position} — ${activity.lines.length > 0 ? "activity" : "context"}`}
            height="max-h-[30rem]"
          >
            {activity.lines.length > 0 ? (
              activity.lines.map((line, i) => (
                <TerminalLine key={i} variant={line.type === "command" ? "command" : "default"}>
                  {line.text || "\u00a0"}
                </TerminalLine>
              ))
            ) : (
              <>
                <TerminalLine variant="muted">&gt; {task.description}</TerminalLine>
                {task.status === "in_progress" && (
                  <TerminalLine variant="command" className="animate-pulse">
                    _
                  </TerminalLine>
                )}
              </>
            )}
          </Terminal>
          {activity.files.length > 0 && <FileChangeList files={activity.files} />}
        </div>

        {/* Details */}
        <div className="space-y-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Details</p>
          <div className="bg-card border border-border rounded-xl p-5 max-w-xl">
            <div className="divide-y divide-border">
              <div className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">
                  <StatusBadge status={task.status} />
                </span>
              </div>
              <div className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">Effort</span>
                <span className="font-mono text-xs font-medium">{task.effort}</span>
              </div>
              {task.severity != null && (
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">Severity</span>
                  <span className="font-medium">{task.severity}</span>
                </div>
              )}
              <div className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium">{relativeDate(task.createdAt)}</span>
              </div>
              <div className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">Started</span>
                <span className="font-medium">
                  {task.startedAt ? relativeDate(task.startedAt) : "—"}
                </span>
              </div>
              <div className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-medium">
                  {task.completedAt ? relativeDate(task.completedAt) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
