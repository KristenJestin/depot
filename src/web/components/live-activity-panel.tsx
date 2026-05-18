import { Card } from "#/web/components/ui/card";
import { Badge } from "#/web/components/ui/badge";
import type { PrdDetailResponse } from "#/web/lib/api-types";
import { formatMetaDate } from "#/web/lib/view-format";

type DetailActivity = PrdDetailResponse["activity"][number];
type DetailTask = PrdDetailResponse["tasks"][number];

type CoderProgressEntry = {
  id: string;
  createdAt: DetailActivity["createdAt"];
  stage: string;
  message: string;
  tool: string | null;
  file: string | null;
  command: string | null;
  source: string | null;
  taskId: string | null;
  taskTitle: string | null;
};

const MAX_ENTRIES = 50;

/**
 * Live stream of `coder_progress` events for an in-flight coder run.
 *
 * Renders only when the PRD is `in_progress`. Picks up new events through
 * the same React Query polling that already drives the rest of the detail
 * page (`liveQueryOptions`, 4 s) — no extra endpoint or transport needed.
 */
export function LiveActivityPanel({
  prdStatus,
  activity,
  tasks,
}: {
  prdStatus: PrdDetailResponse["prd"]["status"];
  activity: DetailActivity[];
  tasks: DetailTask[];
}) {
  if (prdStatus !== "in_progress") {
    return null;
  }

  const entries = buildEntries(activity, tasks);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Live activity
        </p>
        <span className="text-xs text-muted-foreground">
          {entries.length === MAX_ENTRIES
            ? `last ${MAX_ENTRIES}`
            : `${entries.length} event${entries.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <Card className="border border-card-border p-0">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Waiting for the coder to log progress…
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto divide-y divide-card-border">
            {entries.map((entry) => (
              <LiveActivityRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}

function LiveActivityRow({ entry }: { entry: CoderProgressEntry }) {
  return (
    <div className="space-y-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={stageVariant(entry.stage)}>{entry.stage}</Badge>
        {entry.tool ? (
          <span className="font-mono text-xs text-muted-foreground">[{entry.tool}]</span>
        ) : null}
        {entry.source === "plugin" ? <Badge variant="outline">plugin</Badge> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatMetaDate(entry.createdAt)}
        </span>
      </div>

      <p className="text-xs leading-5 text-secondary-foreground">{entry.message}</p>

      {entry.file ? <p className="font-mono text-xs text-muted-foreground">{entry.file}</p> : null}
      {entry.command ? (
        <p className="font-mono text-xs text-muted-foreground">$ {entry.command}</p>
      ) : null}
      {entry.taskTitle ? (
        <p className="text-xs text-muted-foreground">↳ {entry.taskTitle}</p>
      ) : null}
    </div>
  );
}

function buildEntries(activity: DetailActivity[], tasks: DetailTask[]): CoderProgressEntry[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const entries: CoderProgressEntry[] = [];

  // Activity is delivered oldest-first; we want newest-first capped at MAX_ENTRIES.
  for (let i = activity.length - 1; i >= 0 && entries.length < MAX_ENTRIES; i--) {
    const event = activity[i]!;
    if (event.eventType !== "coder_progress") continue;

    const payload = event.payload as Record<string, unknown>;
    const taskId = typeof payload.taskId === "string" ? payload.taskId : (event.taskId ?? null);
    entries.push({
      id: event.id,
      createdAt: event.createdAt,
      stage: typeof payload.stage === "string" ? payload.stage : "note",
      message: typeof payload.message === "string" ? payload.message : "",
      tool: typeof payload.tool === "string" ? payload.tool : null,
      file: typeof payload.file === "string" ? payload.file : null,
      command: typeof payload.command === "string" ? payload.command : null,
      source: typeof payload.source === "string" ? payload.source : null,
      taskId,
      taskTitle: taskId ? (taskById.get(taskId)?.title ?? null) : null,
    });
  }

  return entries;
}

function stageVariant(stage: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (stage) {
    case "start":
      return "statusInProgress";
    case "edit":
      return "subtle";
    case "verify":
      return "severityInfo";
    case "tool":
      return "outline";
    case "note":
      return "neutral";
    default:
      return "subtle";
  }
}
