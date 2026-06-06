import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { KanbanBoard } from "#/web/components/kanban-board";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import { PendingActionsPanel } from "#/web/components/pending-actions-panel";
import { PrdFiltersBar, type PrdFilterValues } from "#/web/components/prd-filters-bar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "#/web/components/ui/select";
import { contextQuery, prdsQuery, workspacesQuery, type PrdsListFilters } from "#/web/lib/queries";
import { buildBoardColumns } from "#/web/lib/prd-view-model";
import { VALID_PRD_PRIORITIES, type PrdPriority } from "#/shared/validator";

type DashboardSearch = {
  tag?: string;
  milestone?: string;
  dependsOn?: string;
};

const sanitize = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    tag: sanitize(search.tag),
    milestone: sanitize(search.milestone),
    dependsOn: sanitize(search.dependsOn ?? search.depends_on),
  }),
  loaderDeps: ({ search }) => ({
    tag: search.tag,
    milestone: search.milestone,
    dependsOn: search.dependsOn,
  }),
  loader: ({ deps }) => prdsQuery.list.ensureQueryData(toFilters(deps)),
  component: DashboardRoute,
});

function toFilters(search: DashboardSearch): PrdsListFilters {
  return {
    ...(search.tag ? { tag: search.tag } : {}),
    ...(search.milestone ? { milestone: search.milestone } : {}),
    ...(search.dependsOn ? { dependsOn: search.dependsOn } : {}),
  };
}

function DashboardRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filters = toFilters(search);
  const { data } = prdsQuery.list.useSuspense(filters);
  const { data: contextData } = useQuery(contextQuery.options());
  const { data: wsData } = useQuery(workspacesQuery.options());
  const filterValues: PrdFilterValues = {
    tag: search.tag ?? "",
    milestone: search.milestone ?? "",
    dependsOn: search.dependsOn ?? "",
  };
  const handleFilterChange = (next: PrdFilterValues) => {
    void navigate({
      search: {
        tag: next.tag.trim() || undefined,
        milestone: next.milestone.trim() || undefined,
        dependsOn: next.dependsOn.trim() || undefined,
      },
      replace: true,
    });
  };
  const [priorityFilter, setPriorityFilter] = useState<PrdPriority | "all">("all");
  // Show the per-card project badge whenever no specific workspace is
  // selected — that's the "All projects" view set via the workspace
  // switcher (cookie sentinel `__cleared`). The badge would be redundant
  // when the dashboard is already filtered to a single project.
  const showProjectBadges = contextData !== undefined && contextData.workspaceId === null;
  const currentWs = wsData?.workspaces.find((w) => w.id === contextData?.workspaceId);
  const currentProjectId = currentWs?.projectId ?? null;
  const filteredPrds =
    priorityFilter === "all"
      ? data.prds
      : data.prds.filter((p) => (p.priority ?? "normal") === priorityFilter);
  const columns = buildBoardColumns(filteredPrds);
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
            <label className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <span>Priority:</span>
              <Select
                value={priorityFilter}
                onValueChange={(value) =>
                  setPriorityFilter((value as PrdPriority | "all") ?? "all")
                }
              >
                <SelectTrigger
                  aria-label="Filter PRDs by priority"
                  className="min-h-7 w-24 px-2 py-1 text-xs"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">all</SelectItem>
                  {VALID_PRD_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
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

      <PageContent className="flex flex-col overflow-hidden">
        <PrdFiltersBar
          values={filterValues}
          onChange={handleFilterChange}
          resultCount={data.prds.length}
        />
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
