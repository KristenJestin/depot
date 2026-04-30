import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { PrdHeaderCard } from "#/web/components/prd-header-card";
import { PrdNoticeBanner } from "#/web/components/prd-notice-banner";
import { PrdSidebar } from "#/web/components/prd-sidebar";
import { StageTimeline } from "#/web/components/stage-timeline";
import { TaskDrawer } from "#/web/components/task-drawer";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import { EmptyState } from "#/web/components/ui/empty-state";
import { StatusBadge } from "#/web/components/ui/status-badge";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import { prdsQuery } from "#/web/lib/queries";
import {
  buildDetailSummary,
  buildRevisionEntries,
  buildStageCards,
} from "#/web/lib/prd-view-model";
import { formatMetaDate } from "#/web/lib/view-format";

export const Route = createFileRoute("/prds/$id/reviews/$reviewId")({
  validateSearch: (search: Record<string, unknown>) => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
  loader: async ({ params }) => {
    const data = await prdsQuery.detail.ensureQueryData(params.id);
    if (!data.reviews.some((review) => review.id === params.reviewId)) {
      throw notFound();
    }
  },
  component: ReviewDetailPage,
});

type DetailReview = PrdDetailResponse["reviews"][number];
type DetailFinding = DetailReview["findings"][number];

function ReviewDetailPage() {
  const { id, reviewId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = prdsQuery.detail.useSuspense(id);

  const reviewIndex = data.reviews.findIndex((candidate) => candidate.id === reviewId);
  const review = reviewIndex === -1 ? null : data.reviews[reviewIndex];

  if (!review) {
    throw notFound();
  }

  const summary = buildDetailSummary(data);
  const revisions = buildRevisionEntries(data);
  const stages = buildStageCards(data);
  const cycleNumber = review.phaseNumber ?? reviewIndex + 1;
  const headRevision = revisions.find((revision) => revision.isHead);
  const isSuperseded = data.prd.supersededAt !== null;
  const selectedTask =
    data.tasks.find((task) => task.id === search.taskId) ??
    data.reviews
      .flatMap((candidate) => candidate.findings)
      .find((task) => task.id === search.taskId) ??
    null;
  const allTasks = [...data.tasks, ...data.reviews.flatMap((candidate) => candidate.findings)];
  const reviewStages = stages.filter(
    (card) => card.review?.id === review.id || card.id === `rework-${review.id}`,
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-app-gradient">
      <div className="border-b border-card-border bg-card/80 px-6 py-3 backdrop-blur">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="transition-colors hover:text-foreground">
                PRDs
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link
                to="/prds/$id"
                params={{ id: data.prd.id }}
                className="transition-colors hover:text-foreground"
              >
                {isSuperseded ? `Rev. ${data.prd.revision}` : data.prd.title}
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Review #{cycleNumber}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="min-h-0 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-7xl items-start gap-6">
          <main
            className={["min-w-0 flex-1 space-y-4", selectedTask ? "opacity-60" : undefined]
              .filter(Boolean)
              .join(" ")}
          >
            {isSuperseded ? (
              <PrdNoticeBanner
                variant="superseded"
                message="This revision was superseded before it was ever activated. Its tasks were never run."
                targetRevisionId={headRevision?.id}
              />
            ) : null}

            {data.prd.status === "canceled" ? (
              <PrdNoticeBanner
                variant="canceled"
                message={`This PRD was canceled after ${summary.doneTasks} of ${summary.totalTasks} tasks were completed.`}
              />
            ) : null}

            <PrdHeaderCard prd={data.prd} summary={summary} />
            <ReviewSummaryCard review={review} cycleNumber={cycleNumber} />

            {reviewStages.length > 0 ? (
              <div
                onClickCapture={(event) => {
                  const target = event.target as HTMLElement | null;
                  const taskId = target?.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
                  if (!taskId) {
                    return;
                  }

                  navigate({
                    to: ".",
                    params: { id, reviewId },
                    search: { taskId },
                  });
                }}
              >
                <StageTimeline cards={reviewStages} />
              </div>
            ) : (
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Tasks
                </p>
                <Card className="p-4">
                  <EmptyState message="This review has no findings yet." />
                </Card>
              </section>
            )}

            {review.findings.length > 0 ? (
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Findings
                </p>
                <Card className="p-4">
                  <div className="space-y-3">
                    {review.findings.map((finding) => (
                      <button
                        key={finding.id}
                        type="button"
                        onClick={() =>
                          navigate({
                            to: ".",
                            params: { id, reviewId },
                            search: { taskId: finding.id },
                          })
                        }
                        className="flex w-full items-start justify-between gap-3 border-b border-card-border pb-3 text-left transition-colors hover:bg-panel-muted last:border-b-0 last:pb-0"
                      >
                        <div className="min-w-0 space-y-2">
                          <p className="text-sm text-secondary-foreground">{finding.title}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            {finding.severity ? (
                              <Badge variant={severityVariant(finding.severity)}>
                                {finding.severity}
                              </Badge>
                            ) : null}
                            <StatusBadge status={finding.status} />
                            <Badge variant="subtle">{finding.effort}</Badge>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {finding.position > 0 ? `#${finding.position}` : "task"}
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>
              </section>
            ) : null}
          </main>

          <PrdSidebar
            prd={data.prd}
            workspace={data.workspace}
            revisions={revisions}
            reviews={data.reviews}
            activity={data.activity}
            summary={summary}
          />
        </div>

        {selectedTask ? (
          <TaskDrawer
            task={selectedTask}
            reviews={data.reviews}
            allTasks={allTasks}
            onClose={() =>
              navigate({
                to: ".",
                params: { id, reviewId },
                search: {},
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function ReviewSummaryCard({ review, cycleNumber }: { review: DetailReview; cycleNumber: number }) {
  const resolvedCount = review.findings.filter(
    (finding) => finding.status === "done" || finding.status === "skipped",
  ).length;
  const remainingCount = review.findings.length - resolvedCount;

  return (
    <Card>
      <div className="space-y-5 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={review.type === "human" ? "severityInfo" : "subtle"}>
                {review.type}
              </Badge>
              <StatusBadge status={review.status} />
              <Badge variant="outline">Review #{cycleNumber}</Badge>
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              {reviewTitle(review, cycleNumber)}
            </h2>
            <p className="text-sm text-muted-foreground">
              Opened {formatMetaDate(review.createdAt)}
              {review.doneAt ? ` · Closed ${formatMetaDate(review.doneAt)}` : " · Waiting on fixes"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Findings" value={String(review.findings.length)} />
            <MetricCard label="Resolved" value={String(resolvedCount)} />
            <MetricCard label="Remaining" value={String(remainingCount)} />
          </div>
        </div>

        {review.userFeedback ? (
          <blockquote className="rounded-r-lg border-l-2 border-card-border bg-panel-muted px-3 py-2 text-sm italic leading-6 text-secondary-foreground">
            {review.userFeedback}
          </blockquote>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(["critical", "major", "minor", "info"] as const).map((severity) => (
            <SeverityStat
              key={severity}
              severity={severity}
              count={review.findings.filter((finding) => finding.severity === severity).length}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-panel-muted px-3 py-3">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SeverityStat({
  severity,
  count,
}: {
  severity: NonNullable<DetailFinding["severity"]>;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-card-border bg-panel-muted px-3 py-3">
      <Badge variant={severityVariant(severity)}>{severity}</Badge>
      <span className="text-sm font-medium text-secondary-foreground">{count}</span>
    </div>
  );
}

function reviewTitle(review: DetailReview, cycleNumber: number) {
  return `${review.type === "human" ? "Human" : "Agent"} Review #${cycleNumber}`;
}

function severityVariant(severity: NonNullable<DetailFinding["severity"]>) {
  if (severity === "critical") {
    return "severityCritical" as const;
  }

  if (severity === "major") {
    return "severityMajor" as const;
  }

  if (severity === "minor") {
    return "severityMinor" as const;
  }

  return "severityInfo" as const;
}
