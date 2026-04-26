import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronRightIcon, ArchiveIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";

import { prdsQuery } from "../lib/queries";
import type { Task } from "../lib/api-types";
import type { PrdDetailResponse } from "../lib/api-types";
import { relativeDate } from "../lib/format";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/ui/status-badge";
import { EmptyState } from "../components/ui/empty-state";
import { ProgressBar } from "../components/ui/progress";
import { TaskCard } from "../components/task-card";
import { FindingRow } from "../components/findings-panel";

export const Route = createFileRoute("/prds/$id/")({
  component: PrdDetailPage,
});

function PrdDetailPage() {
  const { id } = Route.useParams();
  const { data } = prdsQuery.detail.useSuspense(id);
  const navigate = useNavigate();

  const { prd, tasks, review, revisions } = data;
  const doneTasks = tasks.filter((t) => t.status === "done");
  const pct = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;
  const findings = review?.findings ?? [];

  const latestRevision = revisions[revisions.length - 1];
  const isSuperseded = revisions.length > 1 && prd.id !== latestRevision?.id;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 md:p-10 flex flex-col xl:flex-row gap-8 items-start max-w-screen-2xl mx-auto">
        {/* Left — main content */}
        <div className="flex-1 space-y-8 min-w-0">
          <header className="space-y-5">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <Link to="/" className="hover:text-foreground transition-colors">
                    Dashboard
                  </Link>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="font-mono">{prd.id}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            {isSuperseded && latestRevision && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/60 px-4 py-2.5 text-sm">
                <ArchiveIcon className="size-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground flex-1">
                  Revision r{prd.revision} — superseded
                </span>
                <Link
                  to="/prds/$id"
                  params={{ id: latestRevision.id }}
                  className="flex items-center gap-1 font-medium text-primary hover:underline shrink-0"
                >
                  View r{latestRevision.revision}
                  <ArrowRightIcon className="size-3" />
                </Link>
              </div>
            )}

            <div className={cn(isSuperseded && "opacity-60")}>
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-sm text-muted-foreground bg-secondary px-2.5 py-1 rounded-md border border-border">
                  {prd.id}
                </span>
                <StatusBadge status={prd.status} />
              </div>
              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">{prd.title}</h1>
            </div>
          </header>

          {(prd.context || prd.scope) && (
            <div className="space-y-6">
              {prd.context && (
                <div>
                  <h3 className="text-base font-semibold mb-2">Context</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{prd.context}</p>
                </div>
              )}
              {prd.scope && (
                <div>
                  <h3 className="text-base font-semibold mb-2">Scope</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{prd.scope}</p>
                </div>
              )}
            </div>
          )}

          <section className="space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-xl font-semibold">Tasks</h3>
              <span className="text-sm font-medium text-muted-foreground">
                {tasks.length} task{tasks.length !== 1 ? "s" : ""}
              </span>
            </div>
            {tasks.length === 0 ? (
              <EmptyState message="No tasks defined." />
            ) : (
              <div className="space-y-3">
                {(tasks as Task[]).map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() =>
                      navigate({
                        to: "/prds/$id/tasks/$taskId",
                        params: { id: prd.id, taskId: task.id },
                      })
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right — sidebar */}
        <div className="w-full xl:w-80 shrink-0 space-y-6">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-5">
            <h4 className="font-semibold text-sm">Status & Metrics</h4>
            <div className="space-y-4 text-sm">
              {tasks.length > 0 && (
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-muted-foreground">Task progress</span>
                    <span className="font-bold text-primary">{pct}%</span>
                  </div>
                  <ProgressBar value={pct} />
                </div>
              )}
              <div
                className={cn(
                  "flex justify-between items-center py-2",
                  tasks.length > 0 && "border-t border-border",
                )}
              >
                <span className="text-muted-foreground">Tasks done</span>
                <span className="font-medium">
                  {doneTasks.length} / {tasks.length}
                </span>
              </div>
              <div className="flex justify-between items-center border-t border-border pt-2">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium">{relativeDate(prd.createdAt) ?? "—"}</span>
              </div>
              <div className="flex justify-between items-center border-t border-border pt-2">
                <span className="text-muted-foreground">Revision</span>
                <span className="font-mono">
                  r{prd.revision}
                  {revisions.length > 1 && (
                    <span className="text-muted-foreground"> / {revisions.length}</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {revisions.length > 1 && (
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
              <h4 className="font-semibold text-sm">Revisions</h4>
              <div className="space-y-1">
                {[...revisions].reverse().map((rev) => {
                  const isCurrent = rev.id === prd.id;
                  const isLatestItem = rev.id === latestRevision?.id;
                  const isSupersededItem = !isLatestItem;
                  return (
                    <Link
                      key={rev.id}
                      to="/prds/$id"
                      params={{ id: rev.id }}
                      className={cn(
                        "flex items-start gap-2 rounded-md px-2 py-2 transition-colors group",
                        isCurrent ? "bg-secondary" : "hover:bg-secondary/60 cursor-pointer",
                        isSupersededItem && !isCurrent && "opacity-50",
                      )}
                    >
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs w-6 shrink-0 text-muted-foreground">
                            r{rev.revision}
                          </span>
                          <StatusBadge status={rev.status} />
                          {isLatestItem && (
                            <span className="text-2xs font-bold uppercase tracking-wider text-primary">
                              latest
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {relativeDate(rev.createdAt)}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "text-xs leading-snug truncate pl-8",
                            isSupersededItem
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                          )}
                        >
                          {rev.title}
                        </p>
                      </div>
                      <ChevronRightIcon className="size-3.5 text-muted-foreground/50 shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {review && (
            <div className="bg-card border border-border border-l-4 border-l-primary rounded-xl p-5 shadow-sm space-y-4 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
              <div className="flex items-center justify-between relative">
                <h4 className="font-semibold text-sm">Review</h4>
                <span className="bg-primary/10 text-primary text-2xs uppercase tracking-wider px-2 py-0.5 rounded-sm font-bold">
                  {review.type}
                </span>
              </div>
              <div className="relative">
                {findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No findings.</p>
                ) : (
                  <div>
                    {(findings as NonNullable<PrdDetailResponse["review"]>["findings"]).map(
                      (f, i) => (
                        <FindingRow key={i} finding={f} />
                      ),
                    )}
                  </div>
                )}
              </div>
              <Link
                to="/prds/$id/reviews/$reviewId"
                params={{ id: prd.id, reviewId: review.id }}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline relative"
              >
                View full review
                <ArrowRightIcon className="size-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
