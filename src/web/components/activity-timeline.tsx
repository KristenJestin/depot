import { TerminalIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "#/web/components/ui/badge";
import { CollapseChevron } from "#/web/components/ui/collapse-chevron";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "#/web/components/ui/collapsible";
import { StatusDot } from "#/web/components/ui/status-dot";
import { cn } from "#/web/lib/utils";
import { formatMetaDate, formatShortDate } from "#/web/lib/view-format";

/**
 * Shared coss-ui timeline pattern for activity surfaces. Entries are grouped
 * under day headers, carry a source badge (ai / human / plugin), render
 * clickable file links, and expand inline bash output. Both the PRD activity
 * widget and the live coder stream feed it the same normalized `TimelineEntry`
 * shape, so the visual language stays coherent across the app.
 */

export type TimelineSource = "ai" | "human" | "plugin";

export type TimelineEntry = {
  id: string;
  createdAt: string | number | Date;
  /** Primary one-line description. */
  label: React.ReactNode;
  /** Optional small tag rendered next to the label (e.g. a stage). */
  tag?: { text: string; variant: React.ComponentProps<typeof Badge>["variant"] };
  source?: TimelineSource | null;
  /** Repo-relative file path; rendered as a clickable link when `onFileClick` is set. */
  file?: string | null;
  /** Shell command associated with the entry. */
  command?: string | null;
  /** Captured stdout/stderr for the command, shown in an expandable panel. */
  output?: string | null;
  /** Secondary muted line (e.g. owning task title). */
  detail?: string | null;
  /** Marks the entry as the timeline head (brighter dot). */
  emphasis?: boolean;
};

const sourceBadge: Record<TimelineSource, React.ComponentProps<typeof Badge>["variant"]> = {
  ai: "subtle",
  human: "severityInfo",
  plugin: "outline",
};

function dayKey(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

export function ActivityTimeline({
  entries,
  emptyMessage = "No activity yet.",
  onFileClick,
  className,
}: {
  entries: TimelineEntry[];
  emptyMessage?: string;
  onFileClick?: (file: string) => void;
  className?: string;
}) {
  if (entries.length === 0) {
    return <p className="px-1 py-6 text-center text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  const groups: Array<{ key: string; label: string; items: TimelineEntry[] }> = [];
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.items.push(entry);
    } else {
      groups.push({ key, label: formatShortDate(entry.createdAt), items: [entry] });
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </p>
          <div>
            {group.items.map((entry, index) => (
              <TimelineRow
                key={entry.id}
                entry={entry}
                last={index === group.items.length - 1}
                onFileClick={onFileClick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineRow({
  entry,
  last,
  onFileClick,
}: {
  entry: TimelineEntry;
  last: boolean;
  onFileClick?: (file: string) => void;
}) {
  const [outputOpen, setOutputOpen] = React.useState(false);

  return (
    <div className="flex gap-3">
      <div className="flex w-3 shrink-0 flex-col items-center pt-1">
        <StatusDot tone={entry.emphasis ? "timeline" : "timeline-muted"} />
        {!last ? (
          <div className="mt-1.5 flex-1 border-l border-dashed border-timeline-line" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.tag ? <Badge variant={entry.tag.variant}>{entry.tag.text}</Badge> : null}
          {entry.source ? <Badge variant={sourceBadge[entry.source]}>{entry.source}</Badge> : null}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {formatMetaDate(entry.createdAt)}
          </span>
        </div>

        <p className="text-xs leading-5 text-secondary-foreground">{entry.label}</p>

        {entry.file ? (
          onFileClick ? (
            <button
              type="button"
              onClick={() => onFileClick(entry.file!)}
              className="block max-w-full truncate text-left font-mono text-[11px] text-primary hover:underline"
              title={entry.file}
            >
              {entry.file}
            </button>
          ) : (
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={entry.file}>
              {entry.file}
            </p>
          )
        ) : null}

        {entry.command ? (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={entry.command}>
            $ {entry.command}
          </p>
        ) : null}

        {entry.output ? (
          <CollapsibleRoot open={outputOpen} onOpenChange={setOutputOpen}>
            <CollapsibleTrigger className="group inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              <CollapseChevron direction="right" size="sm" />
              <TerminalIcon className="size-3" />
              {outputOpen ? "Hide output" : "Show output"}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <pre className="mt-1.5 max-h-48 overflow-auto rounded-md border border-card-border bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground">
                {entry.output}
              </pre>
            </CollapsiblePanel>
          </CollapsibleRoot>
        ) : null}

        {entry.detail ? (
          <p className="truncate text-[11px] text-muted-foreground">↳ {entry.detail}</p>
        ) : null}
      </div>
    </div>
  );
}
