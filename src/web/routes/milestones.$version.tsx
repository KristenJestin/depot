import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import { Badge } from "#/web/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { Button } from "#/web/components/ui/button";
import { StatusBadge } from "#/web/components/ui/status-badge";
import { milestonesQuery } from "#/web/lib/queries";

/**
 * Milestone overview page (PRD 0019 / T4).
 *
 * Lists every PRD targeting `<version>` with its status + a completion gauge
 * derived from `summary.byStatus`. Status pills act as toggle filters on the
 * list so a user can isolate "what's still in progress?" or "what's done?"
 * for a release. Empty milestones render a friendly fallback rather than a
 * blank page so a typo in the URL is obvious.
 */

export type StatusFilter =
  | "all"
  | "draft"
  | "ready"
  | "in_progress"
  | "review"
  | "done"
  | "canceled";

export type MilestoneViewSummary = {
  version: string;
  total: number;
  byStatus: Partial<
    Record<"draft" | "ready" | "in_progress" | "review" | "done" | "canceled", number>
  >;
};

export type MilestoneViewItem = {
  id: string;
  title: string;
  status: "draft" | "ready" | "in_progress" | "review" | "done" | "canceled";
};

type MilestoneSearch = {
  status?: StatusFilter;
};

const STATUS_ORDER: Exclude<StatusFilter, "all">[] = [
  "draft",
  "ready",
  "in_progress",
  "review",
  "done",
  "canceled",
];

const sanitizeStatus = (value: unknown): StatusFilter | undefined => {
  if (typeof value !== "string") return undefined;
  if (value === "all") return "all";
  return (STATUS_ORDER as readonly string[]).includes(value) ? (value as StatusFilter) : undefined;
};

export const Route = createFileRoute("/milestones/$version")({
  validateSearch: (search: Record<string, unknown>): MilestoneSearch => ({
    status: sanitizeStatus(search.status),
  }),
  loader: async ({ params }) => milestonesQuery.detail.ensureQueryData(params.version),
  component: MilestonePage,
});

function MilestonePage() {
  const { version } = Route.useParams();
  const { status: statusFilter = "all" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data } = milestonesQuery.detail.useSuspense(version);
  const handleStatusClick = (next: StatusFilter) => {
    void navigate({
      search: next === "all" ? {} : { status: next },
      replace: true,
    });
  };
  return (
    <MilestonePageView
      version={version}
      data={data}
      statusFilter={statusFilter}
      onStatusClick={handleStatusClick}
    />
  );
}

export function MilestonePageView({
  version,
  data,
  statusFilter,
  onStatusClick,
}: {
  version: string;
  data: { summary: MilestoneViewSummary; items: MilestoneViewItem[] };
  statusFilter: StatusFilter;
  onStatusClick: (next: StatusFilter) => void;
}) {
  const { summary, items } = data;

  const totalDone = summary.byStatus.done ?? 0;
  const totalCanceled = summary.byStatus.canceled ?? 0;
  const totalExclCanceled = Math.max(0, summary.total - totalCanceled);
  const progress = totalExclCanceled === 0 ? 0 : Math.round((totalDone / totalExclCanceled) * 100);

  const visibleItems = React.useMemo(() => {
    if (statusFilter === "all") return items;
    return items.filter((p) => p.status === statusFilter);
  }, [items, statusFilter]);

  return (
    <PageShell>
      <PageTopBar
        actions={
          <Link
            to="/"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to PRDs
          </Link>
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
              <BreadcrumbPage>Milestone {version}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageTopBar>

      <PageContent>
        <div className="space-y-6 p-6">
          <header className="space-y-3">
            <h1 className="text-xl font-semibold text-foreground" data-testid="milestone-headline">
              {version} — {totalDone} / {totalExclCanceled} PRDs done
            </h1>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Milestone completion"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              data-testid="milestone-gauge"
            >
              <div
                className="h-full rounded-full bg-status-done-soft transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {progress}% complete • {summary.total} total
              {totalCanceled > 0 ? ` • ${totalCanceled} canceled` : ""}
            </p>
          </header>

          <nav
            aria-label="Filter by status"
            data-testid="status-filter"
            className="flex flex-wrap gap-1.5"
          >
            <Button
              variant={statusFilter === "all" ? "primary" : "ghost"}
              size="sm"
              onClick={() => onStatusClick("all")}
            >
              All ({summary.total})
            </Button>
            {STATUS_ORDER.map((status) => {
              const count = summary.byStatus[status] ?? 0;
              return (
                <Button
                  key={status}
                  variant={statusFilter === status ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => onStatusClick(status)}
                  disabled={count === 0}
                >
                  <span className="capitalize">{status.replaceAll("_", " ")}</span>
                  <Badge variant="subtle" className="ml-1.5 text-[10px]">
                    {count}
                  </Badge>
                </Button>
              );
            })}
          </nav>

          <section>
            {visibleItems.length === 0 ? (
              <p
                className="rounded-md border border-dashed border-card-border p-6 text-center text-sm text-muted-foreground"
                data-testid="milestone-empty"
              >
                No PRDs target milestone <span className="font-mono">{version}</span>
                {statusFilter !== "all" ? ` with status ${statusFilter}` : ""}.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="milestone-items">
                {visibleItems.map((prd) => (
                  <li key={prd.id}>
                    <Link
                      to="/prds/$id"
                      params={{ id: prd.id }}
                      className="flex items-center justify-between gap-3 rounded-md border border-card-border bg-card px-4 py-3 transition-colors hover:bg-accent"
                    >
                      <span className="truncate text-sm font-medium text-foreground">
                        {prd.title}
                      </span>
                      <StatusBadge status={prd.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </PageContent>
    </PageShell>
  );
}
