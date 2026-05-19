import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { KanbanBoard } from "#/web/components/kanban-board";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import { PendingActionsPanel } from "#/web/components/pending-actions-panel";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { contextQuery, prdsQuery, workspacesQuery } from "#/web/lib/queries";
import { buildBoardColumns } from "#/web/lib/prd-view-model";

export const Route = createFileRoute("/")({
  loader: prdsQuery.list.ensureQueryData,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { data } = prdsQuery.list.useSuspense();
  const { data: contextData } = useQuery(contextQuery.options());
  const { data: wsData } = useQuery(workspacesQuery.options());
  // Show the per-card project badge whenever no specific workspace is
  // selected — that's the "All projects" view set via the workspace
  // switcher (cookie sentinel `__cleared`). The badge would be redundant
  // when the dashboard is already filtered to a single project.
  const showProjectBadges = contextData !== undefined && contextData.workspaceId === null;
  const currentWs = wsData?.workspaces.find((w) => w.id === contextData?.workspaceId);
  const currentProjectId = currentWs?.projectId ?? null;
  const columns = buildBoardColumns(data.prds);
  const total = data.prds.length;
  // "Active" = anything mid-cycle. PRDs in `review` are still part of an
  // active cycle (just blocked on a human), so they count as running too.
  const running = data.prds.filter(
    (prd: (typeof data.prds)[number]) => prd.status === "in_progress" || prd.status === "review",
  ).length;

  return (
    <PageShell>
      <PageTopBar
        actions={
          <>
            <Link
              to="/projects"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              All projects
            </Link>
            {currentProjectId && (
              <>
                <Link
                  to="/projects/$id/docs"
                  params={{ id: currentProjectId }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Docs
                </Link>
                <Link
                  to="/projects/$id/settings"
                  params={{ id: currentProjectId }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Project settings
                </Link>
              </>
            )}
            <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <strong className="font-medium text-secondary-foreground">{total}</strong>
              <span>total</span>
              <span className="text-muted-foreground/50">/</span>
              <strong className="font-medium text-secondary-foreground">{running}</strong>
              <span>running</span>
            </div>
          </>
        }
      >
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>PRDs</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>

      <PageContent>
        {currentProjectId && (
          <div className="p-3">
            <PendingActionsPanel projectId={currentProjectId} />
          </div>
        )}
        <KanbanBoard columns={columns} showProjectBadges={showProjectBadges} />
      </PageContent>
    </PageShell>
  );
}
