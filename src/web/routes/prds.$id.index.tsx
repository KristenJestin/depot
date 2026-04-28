import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArchiveIcon,
  CopyIcon,
  BotIcon,
  UserIcon,
  FlagIcon,
  ZapIcon,
  CheckCircleIcon,
  CircleSlashIcon,
  AlertCircleIcon,
  GitForkIcon,
  RefreshCwIcon,
  PlayIcon,
  SkipForwardIcon,
  MessageSquareIcon,
  ChevronsRightIcon,
} from "lucide-react";
import { useState, useMemo } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../components/ui/breadcrumb";

import { prdsQuery } from "../lib/queries";
import type { Task, PrdReview } from "../lib/api-types";
import { relativeDate } from "../lib/format";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/ui/status-badge";
import { EmptyState } from "../components/ui/empty-state";
import { ProgressBar } from "../components/ui/progress";
import { TaskCard } from "../components/task-card";
import { FindingsTable } from "../components/findings-table";
import { DonutChart } from "../components/ui/donut-chart";

export const Route = createFileRoute("/prds/$id/")({
  component: PrdDetailPage,
});

type TabId = "overview" | "tasks" | "reviews" | "revisions";

// CSS variable references for SVG stroke colors
const COLORS = {
  done: "var(--chart-5)",
  in_progress: "var(--primary)",
  pending: "color-mix(in oklch, var(--muted-foreground) 40%, transparent)",
  blocked: "var(--destructive)",
  skipped: "color-mix(in oklch, var(--muted-foreground) 20%, transparent)",
} as const;

function PrdDetailPage() {
  const { id } = Route.useParams();
  const { data } = prdsQuery.detail.useSuspense(id);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const { prd, tasks, reviews, revisions, activity } = data;
  // Initialize accordion state: human reviews expanded, agent collapsed
  const [expandedReviews, setExpandedReviews] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(reviews.map((r) => [r.id, r.type === "human"])),
  );

  const toggleReview = (reviewId: string) =>
    setExpandedReviews((prev) => ({ ...prev, [reviewId]: !prev[reviewId] }));

  // Task stats
  const tasksByStatus = useMemo(() => {
    const counts = { done: 0, in_progress: 0, pending: 0, blocked: 0, skipped: 0 };
    for (const t of tasks) {
      if (t.status in counts) counts[t.status as keyof typeof counts]++;
    }
    return counts;
  }, [tasks]);
  const doneTasks = tasksByStatus.done + tasksByStatus.skipped;
  const pct = tasks.length ? Math.round((tasksByStatus.done / tasks.length) * 100) : 0;

  // Revisions
  const latestRevision = revisions[revisions.length - 1];
  const isSuperseded = revisions.length > 1 && prd.id !== latestRevision?.id;

  // Next action logic
  const activeReview = reviews.find((r) => r.status !== "done");
  const remainingTasks = tasks.filter((t) => t.status !== "done" && t.status !== "skipped");

  // Donut segments
  const donutSegments = [
    { value: tasksByStatus.done, color: COLORS.done },
    { value: tasksByStatus.in_progress, color: COLORS.in_progress },
    { value: tasksByStatus.pending, color: COLORS.pending },
    { value: tasksByStatus.blocked, color: COLORS.blocked },
    { value: tasksByStatus.skipped, color: COLORS.skipped },
  ].filter((s) => s.value > 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col max-w-screen-2xl mx-auto">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="px-6 md:px-10 pt-6 md:pt-10 pb-6 space-y-4">
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
            <div className="flex items-start gap-3 mb-2">
              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight flex-1">{prd.title}</h1>
              <StatusBadge status={prd.status} className="mt-1.5 shrink-0" />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{prd.id}</span>
              <span>·</span>
              <span>Created {relativeDate(prd.createdAt)}</span>
              {prd.activatedAt && (
                <>
                  <span>·</span>
                  <span>Activated {relativeDate(prd.activatedAt)}</span>
                </>
              )}
              <span>·</span>
              <span className="font-mono">r{prd.revision}</span>
              <button
                type="button"
                title="Copy ID"
                className="ml-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                onClick={() => navigator.clipboard.writeText(prd.id)}
              >
                <CopyIcon className="size-3" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Stats bar ─────────────────────────────────────────────────────── */}
        <div className="px-6 md:px-10 pb-6 grid grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Overall progress */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Overall progress
            </p>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks</p>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <div className="relative shrink-0">
                    <DonutChart segments={donutSegments} size={72} strokeWidth={8} />
                    <span className="absolute inset-0 flex items-center justify-center font-bold text-lg pointer-events-none">
                      {pct}%
                    </span>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-medium">
                      {tasksByStatus.done} / {tasks.length} done
                    </p>
                    <div className="space-y-0.5">
                      {tasksByStatus.in_progress > 0 && (
                        <LegendItem
                          color={COLORS.in_progress}
                          label="in progress"
                          count={tasksByStatus.in_progress}
                        />
                      )}
                      {tasksByStatus.pending > 0 && (
                        <LegendItem
                          color={COLORS.pending}
                          label="pending"
                          count={tasksByStatus.pending}
                        />
                      )}
                      {tasksByStatus.blocked > 0 && (
                        <LegendItem
                          color={COLORS.blocked}
                          label="blocked"
                          count={tasksByStatus.blocked}
                        />
                      )}
                      {tasksByStatus.skipped > 0 && (
                        <LegendItem
                          color={COLORS.skipped}
                          label="skipped"
                          count={tasksByStatus.skipped}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* PRD status */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              PRD status
            </p>
            <p
              className={cn("text-2xl font-bold capitalize", {
                "text-primary": prd.status === "in_progress",
                "text-chart-5": prd.status === "done",
                "text-muted-foreground": prd.status === "draft" || prd.status === "ready",
                "text-destructive": prd.status === "canceled",
              })}
            >
              {prd.status === "in_progress" ? "In progress" : prd.status}
            </p>
            <p className="text-xs text-muted-foreground">
              {prd.activatedAt
                ? `In progress since ${relativeDate(prd.activatedAt)}`
                : `Created ${relativeDate(prd.createdAt)}`}
            </p>
          </div>

          {/* Next action */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Next action
            </p>
            {activeReview ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={activeReview.status} />
                <span className="text-sm">Review {activeReview.status}</span>
              </div>
            ) : remainingTasks.length > 0 ? (
              <p className="text-sm font-medium">{remainingTasks.length} tasks remaining</p>
            ) : prd.status === "done" ? (
              <p className="text-sm font-medium text-chart-5">All done</p>
            ) : (
              <p className="text-sm text-muted-foreground">No tasks defined</p>
            )}
          </div>
        </div>

        {/* ── Tab strip ─────────────────────────────────────────────────────── */}
        <div className="flex gap-6 border-b border-border px-6 md:px-10">
          {(
            [
              { id: "overview", label: "Overview" },
              { id: "tasks", label: `Tasks (${tasks.length})` },
              { id: "reviews", label: `Reviews (${reviews.length})` },
              { id: "revisions", label: `Revisions (${revisions.length})` },
            ] as { id: TabId; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "py-3 text-sm border-b-2 -mb-px transition-colors",
                activeTab === tab.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ───────────────────────────────────────────────────── */}
        <div className="px-6 md:px-10 py-8">
          {activeTab === "overview" && (
            <OverviewTab
              prd={prd}
              reviews={reviews}
              revisions={revisions}
              activity={activity}
              latestRevision={latestRevision}
              expandedReviews={expandedReviews}
              onToggleReview={toggleReview}
            />
          )}
          {activeTab === "tasks" && (
            <TasksTab
              prd={prd}
              tasks={tasks as Task[]}
              doneTasks={doneTasks}
              pct={pct}
              onTaskClick={(taskId) =>
                navigate({ to: "/prds/$id/tasks/$taskId", params: { id: prd.id, taskId } })
              }
            />
          )}
          {activeTab === "reviews" && <ReviewsTab prd={prd} reviews={reviews} />}
          {activeTab === "revisions" && (
            <RevisionsTab prd={prd} revisions={revisions} latestRevision={latestRevision} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Legend item (donut chart) ─────────────────────────────────────────────────

function LegendItem({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="tabular-nums">{count}</span>
      <span>{label}</span>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({
  prd,
  reviews,
  revisions,
  activity,
  latestRevision,
  expandedReviews,
  onToggleReview,
}: {
  prd: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["prd"];
  reviews: PrdReview[];
  revisions: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["revisions"];
  activity: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["activity"];
  latestRevision: (typeof revisions)[number] | undefined;
  expandedReviews: Record<string, boolean>;
  onToggleReview: (id: string) => void;
}) {
  // Build a review lookup for inline rendering in the activity timeline
  const reviewById = useMemo(() => new Map(reviews.map((r) => [r.id, r])), [reviews]);

  // Activity entries in reverse chronological order (newest first)
  const timelineEntries = useMemo(() => [...activity].reverse(), [activity]);

  return (
    <div className="flex flex-col xl:flex-row gap-10 items-start">
      {/* Left column */}
      <div className="flex-none xl:w-2/5 space-y-5 min-w-0">
        {prd.context && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="text-sm font-semibold mb-2">Context</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{prd.context}</p>
          </div>
        )}
        {prd.scope && (
          <div className="bg-card border border-border rounded-xl p-5">
            <h4 className="text-sm font-semibold mb-2">Scope</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">{prd.scope}</p>
          </div>
        )}
        {revisions.length > 1 && (
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">Revisions</h4>
              <button
                type="button"
                disabled
                className="text-xs opacity-40 cursor-not-allowed text-muted-foreground"
              >
                Compare
              </button>
            </div>
            <RevisionList prd={prd} revisions={revisions} latestRevision={latestRevision} />
          </div>
        )}
      </div>

      {/* Right column — Lifecycle timeline */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold mb-5 text-muted-foreground uppercase tracking-wider">
          Lifecycle
        </h4>
        {timelineEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <div className="relative space-y-0 before:absolute before:left-3 before:top-0 before:bottom-0 before:w-px before:bg-border">
            {timelineEntries.map((entry) => (
              <ActivityEntry
                key={entry.id}
                entry={entry}
                prdId={prd.id}
                reviewById={reviewById}
                expandedReviews={expandedReviews}
                onToggleReview={onToggleReview}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Activity timeline entry ───────────────────────────────────────────────────

type ActivityEntryData = ReturnType<
  typeof prdsQuery.detail.useSuspense
>["data"]["activity"][number];

function activityIcon(eventType: string): React.ReactNode {
  switch (eventType) {
    case "prd_created":
      return <FlagIcon className="size-3 text-white" />;
    case "prd_forked":
      return <GitForkIcon className="size-3 text-white" />;
    case "prd_updated":
    case "prd_reload":
      return <RefreshCwIcon className="size-3 text-white" />;
    case "prd_ready":
      return <CheckCircleIcon className="size-3 text-white" />;
    case "prd_activated":
      return <PlayIcon className="size-3 text-white" />;
    case "prd_done":
      return <CheckCircleIcon className="size-3 text-white" />;
    case "prd_canceled":
      return <CircleSlashIcon className="size-3 text-white" />;
    case "phase_advanced":
      return <ChevronsRightIcon className="size-3 text-white" />;
    case "review_created":
    case "review_started":
    case "review_done":
    case "review_updated":
      return <UserIcon className="size-3 text-white" />;
    case "task_created":
    case "task_updated":
      return <ZapIcon className="size-3 text-white" />;
    case "task_started":
      return <PlayIcon className="size-3 text-white" />;
    case "task_done":
      return <CheckCircleIcon className="size-3 text-white" />;
    case "task_blocked":
      return <AlertCircleIcon className="size-3 text-white" />;
    case "task_skipped":
      return <SkipForwardIcon className="size-3 text-white" />;
    case "note":
      return <MessageSquareIcon className="size-3 text-white" />;
    default:
      return <ZapIcon className="size-3 text-white" />;
  }
}

function activityDotColor(eventType: string): string {
  switch (eventType) {
    case "prd_created":
    case "prd_forked":
      return "bg-muted-foreground/60";
    case "prd_ready":
    case "prd_done":
    case "task_done":
      return "bg-chart-5";
    case "prd_activated":
    case "task_started":
    case "phase_advanced":
      return "bg-primary";
    case "prd_canceled":
    case "task_blocked":
      return "bg-destructive";
    case "review_created":
    case "review_started":
    case "review_done":
    case "review_updated":
      return "bg-chart-2";
    case "note":
      return "bg-chart-3";
    default:
      return "bg-muted-foreground/40";
  }
}

function activityLabel(eventType: string, payload: Record<string, unknown>): string {
  switch (eventType) {
    case "prd_created":
      return `Revision created`;
    case "prd_forked":
      return `Forked to revision ${String(payload.revision ?? "")}`;
    case "prd_updated":
      return `PRD updated`;
    case "prd_ready":
      return `Marked ready`;
    case "prd_activated":
      return `Activated (in progress)`;
    case "prd_done":
      return `Marked done`;
    case "prd_canceled":
      return `Canceled`;
    case "phase_advanced": {
      const from = payload.fromPhase;
      const to = payload.toPhase;
      return to !== undefined
        ? `Phase advanced: ${String(from)} → ${String(to)}`
        : `Final phase completed (phase ${String(from)})`;
    }
    case "review_created":
      return `Review created [${String(payload.type ?? "")}]`;
    case "review_started":
      return `Review started`;
    case "review_done":
      return `Review done`;
    case "review_updated":
      return `Review updated`;
    case "task_created":
      return `Task created: ${String(payload.title ?? "")}`;
    case "task_updated":
      return `Task updated: ${String(payload.title ?? "")}`;
    case "task_started":
      return `Task started: ${String(payload.title ?? "")}`;
    case "task_done":
      return `Task done: ${String(payload.title ?? "")}`;
    case "task_blocked":
      return `Task blocked: ${String(payload.title ?? "")}`;
    case "task_skipped":
      return `Task skipped: ${String(payload.title ?? "")}`;
    case "note":
      return String(payload.message ?? "");
    default:
      return eventType;
  }
}

function ActivityEntry({
  entry,
  prdId,
  reviewById,
  expandedReviews,
  onToggleReview,
}: {
  entry: ActivityEntryData;
  prdId: string;
  reviewById: Map<string, PrdReview>;
  expandedReviews: Record<string, boolean>;
  onToggleReview: (id: string) => void;
}) {
  const payload = entry.payload;

  // For review events, render an expanded review card if the review exists
  const reviewId = typeof payload.reviewId === "string" ? payload.reviewId : null;
  const review = reviewId ? reviewById.get(reviewId) : undefined;

  const isReviewEvent =
    entry.eventType === "review_created" ||
    entry.eventType === "review_started" ||
    entry.eventType === "review_done";

  if (isReviewEvent && review) {
    const isExpanded = expandedReviews[review.id] ?? false;
    return (
      <div className="relative flex gap-4 pb-6">
        <div
          className={cn(
            "shrink-0 size-5 rounded-full ring-2 ring-background z-10 flex items-center justify-center",
            review.type === "agent" ? "bg-chart-1" : "bg-chart-2",
          )}
        >
          {review.type === "agent" ? (
            <BotIcon className="size-3 text-white" />
          ) : (
            <UserIcon className="size-3 text-white" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">{relativeDate(entry.createdAt)}</p>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleReview(review.id)}
              className="w-full flex items-center justify-between gap-3 p-4 hover:bg-secondary/40 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-sm">Review ({review.type})</span>
                <StatusBadge status={review.status} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  to="/prds/$id/reviews/$reviewId"
                  params={{ id: prdId, reviewId: review.id }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-primary hover:underline"
                >
                  View →
                </Link>
                <ChevronDownIcon
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    isExpanded && "rotate-180",
                  )}
                />
              </div>
            </button>
            {isExpanded && (
              <div className="border-t border-border p-4 space-y-3">
                {review.userFeedback && (
                  <p className="text-sm text-muted-foreground italic">
                    Feedback: {review.userFeedback}
                  </p>
                )}
                {review.findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No findings.</p>
                ) : (
                  <FindingsTable findings={review.findings} prdId={prdId} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const label = activityLabel(entry.eventType, payload);
  const dotColor = activityDotColor(entry.eventType);

  return (
    <div className="relative flex gap-4 pb-4">
      <div
        className={cn(
          "shrink-0 size-5 rounded-full ring-2 ring-background z-10 flex items-center justify-center",
          dotColor,
        )}
      >
        {activityIcon(entry.eventType)}
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-xs text-muted-foreground mb-0.5">{relativeDate(entry.createdAt)}</p>
        <p className="text-sm leading-snug">{label}</p>
      </div>
    </div>
  );
}

// ── Tasks tab ─────────────────────────────────────────────────────────────────

function TasksTab({
  tasks,
  doneTasks,
  pct,
  onTaskClick,
}: {
  prd: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["prd"];
  tasks: Task[];
  doneTasks: number;
  pct: number;
  onTaskClick: (taskId: string) => void;
}) {
  return (
    <div className="space-y-5 max-w-3xl">
      {tasks.length > 0 && (
        <div className="space-y-2">
          <ProgressBar value={pct} />
          <p className="text-sm text-muted-foreground">
            {doneTasks} / {tasks.length} tasks done
          </p>
        </div>
      )}
      {tasks.length === 0 ? (
        <EmptyState message="No tasks defined." />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reviews tab ───────────────────────────────────────────────────────────────

function ReviewsTab({
  prd,
  reviews,
}: {
  prd: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["prd"];
  reviews: PrdReview[];
}) {
  const sorted = useMemo(() => [...reviews].reverse(), [reviews]);

  if (reviews.length === 0) {
    return <EmptyState message="No reviews yet." />;
  }

  return (
    <div className="space-y-3 max-w-3xl">
      {sorted.map((review) => (
        <div
          key={review.id}
          className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="text-2xs uppercase tracking-wider px-2 py-0.5 rounded-sm border border-border font-medium shrink-0">
              {review.type}
            </span>
            <StatusBadge status={review.status} />
            <span className="text-xs text-muted-foreground">{relativeDate(review.createdAt)}</span>
            <span className="text-xs text-muted-foreground">
              {review.findings.length} finding{review.findings.length !== 1 ? "s" : ""}
            </span>
          </div>
          <Link
            to="/prds/$id/reviews/$reviewId"
            params={{ id: prd.id, reviewId: review.id }}
            className="text-xs text-primary hover:underline shrink-0"
          >
            View review →
          </Link>
        </div>
      ))}
    </div>
  );
}

// ── Revisions tab ─────────────────────────────────────────────────────────────

function RevisionsTab({
  prd,
  revisions,
  latestRevision,
}: {
  prd: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["prd"];
  revisions: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["revisions"];
  latestRevision: (typeof revisions)[number] | undefined;
}) {
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Revisions ({revisions.length})</h3>
        <button
          type="button"
          disabled
          className="text-xs opacity-40 cursor-not-allowed text-muted-foreground"
        >
          Compare revisions
        </button>
      </div>
      <RevisionList prd={prd} revisions={revisions} latestRevision={latestRevision} />
    </div>
  );
}

// ── Shared revision list ──────────────────────────────────────────────────────

function RevisionList({
  prd,
  revisions,
  latestRevision,
}: {
  prd: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["prd"];
  revisions: ReturnType<typeof prdsQuery.detail.useSuspense>["data"]["revisions"];
  latestRevision: (typeof revisions)[number] | undefined;
}) {
  return (
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
                  isSupersededItem ? "text-muted-foreground line-through" : "text-foreground",
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
  );
}
