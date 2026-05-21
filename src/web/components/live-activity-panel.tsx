import { ActivityTimeline, type TimelineEntry } from "#/web/components/activity-timeline";
import { Badge } from "#/web/components/ui/badge";
import { Card } from "#/web/components/ui/card";
import type { PrdDetailResponse } from "#/web/lib/api-types";

type DetailActivity = PrdDetailResponse["activity"][number];
type DetailTask = PrdDetailResponse["tasks"][number];

const MAX_ENTRIES = 50;

/**
 * Live stream of `coder_progress` events for an in-flight coder run.
 *
 * Renders only when the PRD is `in_progress`. Picks up new events through
 * the same React Query polling that already drives the rest of the detail
 * page (`liveQueryOptions`, 4 s) — no extra endpoint or transport needed.
 * The stream is presented through the shared `ActivityTimeline` so it shares
 * the day-grouping, source badges, and expandable bash output of the rest of
 * the app.
 */
export function LiveActivityPanel({
  prdStatus,
  activity,
  tasks,
  onFileClick,
}: {
  prdStatus: PrdDetailResponse["prd"]["status"];
  activity: DetailActivity[];
  tasks: DetailTask[];
  onFileClick?: (file: string) => void;
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

      <Card className="border border-card-border p-4">
        <div className="max-h-[420px] overflow-y-auto">
          <ActivityTimeline
            entries={entries}
            emptyMessage="Waiting for the coder to log progress…"
            onFileClick={onFileClick}
          />
        </div>
      </Card>
    </section>
  );
}

function buildEntries(activity: DetailActivity[], tasks: DetailTask[]): TimelineEntry[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const entries: TimelineEntry[] = [];

  // Activity is delivered oldest-first; we want newest-first capped at MAX_ENTRIES.
  for (let i = activity.length - 1; i >= 0 && entries.length < MAX_ENTRIES; i--) {
    const event = activity[i]!;
    if (event.eventType !== "coder_progress") continue;

    const payload = event.payload as Record<string, unknown>;
    const taskId = typeof payload.taskId === "string" ? payload.taskId : (event.taskId ?? null);
    const stage = typeof payload.stage === "string" ? payload.stage : "note";
    const tool = typeof payload.tool === "string" ? payload.tool : null;
    const message = typeof payload.message === "string" ? payload.message : "";
    const taskTitle = taskId ? (taskById.get(taskId)?.title ?? null) : null;

    entries.push({
      id: event.id,
      createdAt: event.createdAt,
      label: tool ? (
        <>
          <span className="font-mono text-muted-foreground">[{tool}]</span> {message}
        </>
      ) : (
        message
      ),
      tag: { text: stage, variant: stageVariant(stage) },
      source: payload.source === "plugin" ? "plugin" : "ai",
      file: typeof payload.file === "string" ? payload.file : null,
      command: typeof payload.command === "string" ? payload.command : null,
      output: typeof payload.output === "string" ? payload.output : null,
      detail: taskTitle,
      emphasis: entries.length === 0,
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
    case "error":
      return "severityCritical";
    case "note":
      return "neutral";
    default:
      return "subtle";
  }
}
