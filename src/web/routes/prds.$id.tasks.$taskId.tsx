import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { tasksQuery } from "../lib/queries";
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

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={task.status} />
              <span className="font-mono text-sm text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded">
                {task.effort}
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{task.title}</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left — terminal activity + file changes */}
          <div className="lg:col-span-2 space-y-6">
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

            <FileChangeList files={activity.files} />
          </div>

          {/* Right — execution plan + blocked reason */}
          <div className="space-y-6">
            <TaskDetail task={task} />

            {task.blockedReason && (
              <div className="bg-card border border-destructive/30 rounded-xl p-5 shadow-sm">
                <h4 className="font-semibold text-sm mb-3 text-destructive">Blocked</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {task.blockedReason}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
