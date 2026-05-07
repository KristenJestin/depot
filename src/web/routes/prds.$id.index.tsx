import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PrdHeaderCard } from "#/web/components/prd-header-card";
import { PrdNoticeBanner } from "#/web/components/prd-notice-banner";
import { PrdSidebar } from "#/web/components/prd-sidebar";
import { ReviewDrawer } from "#/web/components/review-drawer";
import { StageTimeline } from "#/web/components/stage-timeline";
import { TaskDrawer } from "#/web/components/task-drawer";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { prdsQuery } from "#/web/lib/queries";
import {
  buildDetailSummary,
  buildRevisionEntries,
  buildStageCards,
} from "#/web/lib/prd-view-model";

export const Route = createFileRoute("/prds/$id/")({
  component: PrdDetailRoute,
});

function PrdDetailRoute() {
  const { id } = Route.useParams();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const { data } = prdsQuery.detail.useSuspense(id);

  const summary = buildDetailSummary(data);
  const stages = buildStageCards(data);
  const revisions = buildRevisionEntries(data);
  const headRevision = revisions.find((revision) => revision.isHead);
  const isSuperseded = data.prd.supersededAt !== null;
  const selectedTask =
    data.tasks.find((task) => task.id === selectedTaskId) ??
    data.reviews.flatMap((review) => review.findings).find((task) => task.id === selectedTaskId) ??
    null;
  const allTasks = [...data.tasks, ...data.reviews.flatMap((review) => review.findings)];
  const selectedReview = selectedReviewId
    ? (data.reviews.find((review) => review.id === selectedReviewId) ?? null)
    : null;

  // Retain the last opened task / review during the close-out animation so the
  // drawer content does not vanish before its slide-out transition completes.
  const [lastTask, setLastTask] = useState(selectedTask);
  const [lastReview, setLastReview] = useState(selectedReview);
  useEffect(() => {
    if (selectedTask) setLastTask(selectedTask);
  }, [selectedTask]);
  useEffect(() => {
    if (selectedReview) setLastReview(selectedReview);
  }, [selectedReview]);

  const lastReviewIndex = lastReview
    ? data.reviews.findIndex((r) => r.id === lastReview.id) + 1
    : 0;

  return (
    <PageShell>
      <PageTopBar>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link to="/" className="transition-colors hover:text-foreground">
                PRDs
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {isSuperseded ? `Rev. ${data.prd.revision}` : data.prd.title}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>

      <PageContent
        className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6"
        onClickCapture={(event) => {
          const target = event.target as HTMLElement | null;
          const reviewId = target?.closest<HTMLElement>("[data-review-id]")?.dataset.reviewId;
          if (reviewId) {
            event.stopPropagation();
            setSelectedTaskId(null);
            setSelectedReviewId(reviewId);
            return;
          }
          const taskId = target?.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
          if (taskId) {
            setSelectedReviewId(null);
            setSelectedTaskId(taskId);
          }
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-col items-stretch gap-6 xl:flex-row xl:items-start">
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
            <StageTimeline cards={stages} />
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

        <TaskDrawer
          task={selectedTask ?? lastTask}
          open={selectedTask !== null}
          reviews={data.reviews}
          allTasks={allTasks}
          onClose={() => setSelectedTaskId(null)}
        />

        <ReviewDrawer
          review={selectedReview ?? lastReview}
          open={selectedReview !== null}
          index={lastReviewIndex}
          onClose={() => setSelectedReviewId(null)}
          onSelectFinding={(taskId) => {
            setSelectedReviewId(null);
            setSelectedTaskId(taskId);
          }}
        />
      </PageContent>
    </PageShell>
  );
}
