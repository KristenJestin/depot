import { Link, createFileRoute } from "@tanstack/react-router";
import { ListTreeIcon, PanelRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { LiveActivityPanel } from "#/web/components/live-activity-panel";
import { PrdHeaderCard } from "#/web/components/prd-header-card";
import { PrdNoticeBanner } from "#/web/components/prd-notice-banner";
import {
  PrdActivityWidget,
  PrdInfoWidget,
  PrdReviewsWidget,
  PrdRevisionsWidget,
} from "#/web/components/prd-sidebar";
import { ReviewDrawer } from "#/web/components/review-drawer";
import { StageTimeline } from "#/web/components/stage-timeline";
import { TaskDrawer } from "#/web/components/task-drawer";
import { ThreePane } from "#/web/components/three-pane";
import { PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Button } from "#/web/components/ui/button";
import { usePersistedState } from "#/web/lib/use-persisted-state";
import { prdsQuery } from "#/web/lib/queries";
import {
  buildDetailSummary,
  buildRevisionEntries,
  buildStageCards,
} from "#/web/lib/prd-view-model";

const TASKS_PANE_STORAGE_KEY = "depot.prd-detail.tasks-pane";
const SIDE_PANE_STORAGE_KEY = "depot.prd-detail.side-pane";

export const Route = createFileRoute("/prds/$id/")({
  component: PrdDetailRoute,
});

function PrdDetailRoute() {
  const { id } = Route.useParams();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = usePersistedState(TASKS_PANE_STORAGE_KEY, true);
  const [sideOpen, setSideOpen] = usePersistedState(SIDE_PANE_STORAGE_KEY, true);
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

  // Task / review selection is driven by `data-task-id` / `data-review-id`
  // attributes on the timeline rows and review items, so a single capturing
  // click handler covers every pane.
  const handlePaneClick = (event: React.MouseEvent<HTMLElement>) => {
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
  };

  return (
    <PageShell>
      <PageTopBar
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTasksOpen((o) => !o)}
              title={tasksOpen ? "Hide tasks" : "Show tasks"}
            >
              <ListTreeIcon className="size-3.5" />
              <span className="ml-1.5">Tasks</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSideOpen((o) => !o)}
              title={sideOpen ? "Hide activity" : "Show activity"}
            >
              <PanelRightIcon className="size-3.5" />
              <span className="ml-1.5">Activity</span>
            </Button>
            {data.prd.workspaceId ? (
              <Link
                to="/prds/$id/review-diff"
                params={{ id }}
                className="rounded-md border border-card-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                Review the diff
              </Link>
            ) : null}
          </>
        }
      >
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

      <ThreePane
        leftTitle="Tasks"
        leftOpen={tasksOpen}
        onLeftClose={() => setTasksOpen(false)}
        left={
          <div className="p-4" onClickCapture={handlePaneClick}>
            <StageTimeline cards={stages} />
          </div>
        }
        rightTitle="Activity"
        rightOpen={sideOpen}
        onRightClose={() => setSideOpen(false)}
        right={
          <div className="space-y-4 p-4" onClickCapture={handlePaneClick}>
            <PrdInfoWidget prd={data.prd} workspace={data.workspace} summary={summary} />
            <PrdReviewsWidget reviews={data.reviews} />
            <PrdActivityWidget activity={data.activity} />
            <PrdRevisionsWidget revisions={revisions} />
          </div>
        }
        center={
          <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
            <div
              className={[
                "mx-auto flex max-w-4xl flex-col gap-4",
                selectedTask ? "opacity-60" : undefined,
              ]
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
              <LiveActivityPanel
                prdStatus={data.prd.status}
                activity={data.activity}
                tasks={data.tasks}
              />
            </div>
          </div>
        }
      />

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
    </PageShell>
  );
}
