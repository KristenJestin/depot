import { createFileRoute } from "@tanstack/react-router";

import { KanbanBoard } from "#/web/components/kanban-board";
import { EmptyState } from "#/web/components/ui/empty-state";
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
    <div className="flex h-full min-w-0 flex-col bg-app-gradient">
      <div className="border-b border-card-border bg-card/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>PRDs</span>
          <span>·</span>
          <span>
            <strong className="font-medium text-secondary-foreground">{total}</strong> total
          </span>
          <span>·</span>
          <span>
            <strong className="font-medium text-secondary-foreground">{running}</strong> running
          </span>
        </div>
      </div>

      {total === 0 ? (
        <div className="flex-1">
          <KanbanBoard columns={columns} />
          <div className="pointer-events-none -mt-28 flex justify-start px-10">
            <EmptyState
              className="pointer-events-auto items-start rounded-xl border border-dashed border-card-border bg-transparent px-6 py-6 text-left"
              message="No PRDs yet"
              action={
                <span className="font-mono text-xs text-muted-foreground">depot prd create</span>
              }
            />
          </div>
        </div>
      ) : (
        <KanbanBoard columns={columns} />
      )}
    </div>
  );
}
