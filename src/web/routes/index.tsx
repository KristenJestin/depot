import { createFileRoute } from "@tanstack/react-router";

import { KanbanBoard } from "#/web/components/kanban-board";
import { PageContent, PageShell, PageTopBar } from "#/web/components/page-shell";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/web/components/ui/breadcrumb";
import { prdsQuery } from "#/web/lib/queries";
import { buildBoardColumns } from "#/web/lib/prd-view-model";

export const Route = createFileRoute("/")({
  loader: prdsQuery.list.ensureQueryData,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { data } = prdsQuery.list.useSuspense();
  const columns = buildBoardColumns(data.prds);
  const total = data.prds.length;
  const running = data.prds.filter(
    (prd: (typeof data.prds)[number]) => prd.status === "in_progress",
  ).length;

  return (
    <PageShell>
      <PageTopBar
        actions={
          <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <strong className="font-medium text-secondary-foreground">{total}</strong>
            <span>total</span>
            <span className="text-muted-foreground/50">/</span>
            <strong className="font-medium text-secondary-foreground">{running}</strong>
            <span>running</span>
          </div>
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
        <KanbanBoard columns={columns} />
      </PageContent>
    </PageShell>
  );
}
