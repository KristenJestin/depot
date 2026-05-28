import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTreeIcon, PanelRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { LiveActivityPanel } from "#/web/components/live-activity-panel";
import { PrdHeaderCard } from "#/web/components/prd-header-card";
import { PrdNoticeBanner } from "#/web/components/prd-notice-banner";
import { PrdReposWidget, type PrdRepoSummary } from "#/web/components/prd-repos-widget";
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
  // In draft / ready the PRD is still being planned — every phase is equally
  // "to come". Expand all timeline cards so the author can review the whole
  // plan at a glance without clicking phase by phase.
  const expandAllStages = data.prd.status === "draft" || data.prd.status === "ready";
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
            <StageTimeline cards={stages} expandAll={expandAllStages} />
          </div>
        }
        rightTitle="Activity"
        rightOpen={sideOpen}
        onRightClose={() => setSideOpen(false)}
        right={
          <div className="space-y-4 p-4" onClickCapture={handlePaneClick}>
            <PrdInfoWidget prd={data.prd} workspace={data.workspace} summary={summary} />
            <PrdReposSection prdId={id} />
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

type PrdReposResponse = {
  items: PrdRepoSummary[];
  projectRepos: PrdRepoSummary[];
  implicit: boolean;
};

function PrdReposSection({ prdId }: { prdId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const key = ["prds", prdId, "repos"] as const;

  const reposQ = useQuery({
    queryKey: key,
    queryFn: async (): Promise<PrdReposResponse> => {
      const res = await fetch(`/api/prds/${prdId}/repos`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PrdReposResponse;
    },
  });

  const addM = useMutation({
    mutationFn: async (repoName: string) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdId}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const removeM = useMutation({
    mutationFn: async (repoName: string) => {
      setError(null);
      const res = await fetch(`/api/prds/${prdId}/repos/${encodeURIComponent(repoName)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  if (!reposQ.data) return null;

  return (
    <PrdReposWidget
      items={reposQ.data.items}
      projectRepos={reposQ.data.projectRepos}
      implicit={reposQ.data.implicit}
      onAdd={(name) => addM.mutate(name)}
      onRemove={(name) => removeM.mutate(name)}
      error={error}
      pending={addM.isPending || removeM.isPending}
    />
  );
}
