import { Link, createFileRoute } from "@tanstack/react-router";

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
import { prdsQuery } from "#/web/lib/queries";
import {
  buildDetailSummary,
  buildRevisionEntries,
  buildStageCards,
} from "#/web/lib/prd-view-model";

export const Route = createFileRoute("/prds/$id/")({
  validateSearch: (search: Record<string, unknown>) => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
  component: PrdDetailRoute,
});

function PrdDetailRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = prdsQuery.detail.useSuspense(id);

  const summary = buildDetailSummary(data);
  const stages = buildStageCards(data);
  const revisions = buildRevisionEntries(data);
  const headRevision = revisions.find((revision) => revision.isHead);
  const isSuperseded = data.prd.supersededAt !== null;
  const selectedTask =
    data.tasks.find((task) => task.id === search.taskId) ??
    data.reviews.flatMap((review) => review.findings).find((task) => task.id === search.taskId) ??
    null;
  const allTasks = [...data.tasks, ...data.reviews.flatMap((review) => review.findings)];

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
              <BreadcrumbPage>
                {isSuperseded ? `Rev. ${data.prd.revision}` : data.prd.title}
              </BreadcrumbPage>
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
            <div
              onClickCapture={(event) => {
                const target = event.target as HTMLElement | null;
                const taskId = target?.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
                if (!taskId) {
                  return;
                }

                navigate({
                  to: ".",
                  params: { id },
                  search: { taskId },
                });
              }}
            >
              <StageTimeline cards={stages} />
            </div>
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
                params: { id },
                search: {},
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}
