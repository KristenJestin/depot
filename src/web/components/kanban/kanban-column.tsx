import { KanbanPrdCard } from "#/web/components/kanban/kanban-prd-card";
import { Badge } from "#/web/components/ui/badge";
import { PrdStatusIcon } from "#/web/components/prd-status-icon";
import type { BoardColumn } from "#/web/lib/prd-view-model";

export function KanbanColumn({
  column,
  showProjectBadges = false,
}: {
  column: BoardColumn;
  showProjectBadges?: boolean;
}) {
  return (
    <section
      data-slot="kanban-column"
      className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl bg-muted shadow-card md:w-auto md:min-w-64 md:flex-1"
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 rounded-t-xl bg-muted px-2 py-2">
        <PrdStatusIcon status={column.id === "review" ? "review" : column.id} />
        <h2 className="text-sm font-medium text-foreground">{column.title}</h2>
        <Badge variant="neutral" className="px-2 py-0.5">
          {column.cards.length}
        </Badge>
      </header>

      <div
        data-slot="kanban-column-scroll"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1"
      >
        {column.cards.length > 0 ? (
          column.cards.map((card) => (
            <KanbanPrdCard
              key={card.id}
              card={card}
              columnId={column.id}
              showProjectBadge={showProjectBadges}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-card-border bg-card/60 px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing here
          </div>
        )}
      </div>
    </section>
  );
}
