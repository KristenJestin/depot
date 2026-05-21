import * as React from "react";

import { Markdown } from "#/web/components/markdown";
import { Badge } from "#/web/components/ui/badge";
import { cn } from "#/web/lib/utils";

export type PrdContextPanelData = {
  reviewBrief: string | null;
  currentPhaseTasks: Array<{
    id: string;
    title: string;
    status: string;
    kind?: string | null;
    doneCriteria?: string | null;
  }>;
  futurePhases: Array<{ number: number; taskTitlesShort: string[] }>;
  outOfScopeItems: Array<{ id: string; title: string; reason: string }>;
};

export function PrdContextPanel({
  data,
  className,
}: {
  data: PrdContextPanelData;
  className?: string;
}) {
  const isEmpty =
    !data.reviewBrief &&
    data.currentPhaseTasks.length === 0 &&
    data.futurePhases.length === 0 &&
    data.outOfScopeItems.length === 0;

  if (isEmpty) {
    return (
      <aside className={cn("w-80 border-l border-card-border bg-card p-4", className)}>
        <p className="text-sm text-muted-foreground">No additional context available.</p>
      </aside>
    );
  }

  return (
    <aside
      className={cn("w-80 shrink-0 overflow-auto border-l border-card-border bg-card", className)}
    >
      {data.reviewBrief && (
        <section className="border-b border-card-border bg-secondary/20 p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Phase wrap-up brief
          </h3>
          <div className="prose prose-sm prose-invert max-w-none text-sm">
            <Markdown source={data.reviewBrief} />
          </div>
        </section>
      )}

      {data.currentPhaseTasks.length > 0 && (
        <section className="border-b border-card-border p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            This phase
          </h3>
          <ul className="space-y-2">
            {data.currentPhaseTasks.map((task) => (
              <li key={task.id} className="rounded-md border border-card-border/50 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{task.title}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {task.status}
                  </Badge>
                </div>
                {task.doneCriteria && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {task.doneCriteria}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.futurePhases.length > 0 && (
        <section className="border-b border-card-border p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Future phases
          </h3>
          <ul className="space-y-3 text-sm">
            {data.futurePhases.map((p) => (
              <li key={p.number}>
                <p className="font-medium">Phase {p.number}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {p.taskTitlesShort.map((title, i) => (
                    <li key={`${p.number}-${i}`}>{title}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.outOfScopeItems.length > 0 && (
        <section className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Out of scope
          </h3>
          <ul className="space-y-2 text-sm">
            {data.outOfScopeItems.map((item) => (
              <li key={item.id} title={item.reason}>
                <span className="font-medium">{item.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">— {item.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
