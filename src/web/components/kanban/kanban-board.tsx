import { KanbanColumn } from "#/web/components/kanban/kanban-column";
import type { BoardColumn } from "#/web/lib/prd-view-model";

export function KanbanBoard({
  columns,
  showProjectBadges = false,
}: {
  columns: BoardColumn[];
  showProjectBadges?: boolean;
}) {
  const total = columns.reduce((sum, column) => sum + column.cards.length, 0);
  const active = columns
    .filter((column) => column.id === "in_progress" || column.id === "review")
    .reduce((sum, column) => sum + column.cards.length, 0);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">PRDs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} total / {active} active
          </p>
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border bg-muted px-6 py-10">
          <div className="max-w-sm space-y-2">
            <p className="text-sm font-medium text-foreground">No PRDs yet</p>
            <p className="text-sm text-muted-foreground">
              Create the first one from the CLI to start filling this board.
            </p>
            <p className="font-mono text-xs text-muted-foreground">depot prd create</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="flex min-h-full gap-3 p-0.5 pb-1">
            {columns.map((column) => (
              <KanbanColumn key={column.id} column={column} showProjectBadges={showProjectBadges} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
