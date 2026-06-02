import { useState } from "react";
import type * as React from "react";
import { ExternalLinkIcon } from "lucide-react";

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  AccordionTrigger,
} from "#/web/components/ui/accordion";
import { Badge } from "#/web/components/ui/badge";
import { CollapseChevron } from "#/web/components/ui/collapse-chevron";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "#/web/components/ui/collapsible";
import { TaskIndicator } from "#/web/components/ui/task-indicator";
import type { StageCard, StageItem } from "#/web/lib/prd-view-model";

type PhaseState = "pending" | "coding" | "reviewing" | "done";

type TimelinePhase = {
  id: string;
  phaseNumber: number | null;
  title: string;
  description: string;
  future: boolean;
  cards: TimelineCard[];
};

type TimelineCard = {
  id: string;
  title: string;
  description: string;
  state: PhaseState;
  current: boolean;
  future: boolean;
  reviewId: string | null;
  sortAt: string | null;
  rows: StageItem[];
};

type TaskGroup = {
  id: string;
  title: string;
  rows: StageItem[];
};

export function StageTimeline({
  cards,
  expandAll = false,
}: {
  cards: StageCard[];
  /**
   * When true, every card in the timeline is expanded on mount instead of
   * only the one matching `defaultOpenId`. Used in draft / ready PRDs where
   * every phase is equally "to come" and the reader wants the whole plan
   * dépliée d'un seul coup.
   */
  expandAll?: boolean;
}) {
  const phases = buildTimelinePhases(cards);
  const defaultOpenId = phases.flatMap((phase) => phase.cards).find((card) => card.current)?.id;
  const activePhases = phases.filter((phase) => !phase.future);
  const futurePhases = phases.filter((phase) => phase.future);

  return (
    <div className="space-y-4">
      {futurePhases.length > 0 ? (
        <FuturePhases
          phases={futurePhases}
          defaultOpenId={defaultOpenId ?? null}
          expandAll={expandAll}
        />
      ) : null}
      {activePhases.map((phase) => (
        <PhaseSection
          key={phase.id}
          phase={phase}
          defaultOpenId={defaultOpenId ?? null}
          expandAll={expandAll}
        />
      ))}
    </div>
  );
}

function FuturePhases({
  phases,
  defaultOpenId,
  expandAll,
}: {
  phases: TimelinePhase[];
  defaultOpenId: string | null;
  expandAll: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <CollapsibleRoot
      open={open}
      onOpenChange={setOpen}
      className="border-b border-dashed border-timeline-line pb-3"
    >
      <div>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 text-left">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Future phases
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Badge variant="outline">
              {phases.length} phase{phases.length === 1 ? "" : "s"}
            </Badge>
            <CollapseChevron />
          </span>
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <div className="space-y-4 mt-4">
          {phases.map((phase) => (
            <PhaseSection
              key={phase.id}
              phase={phase}
              defaultOpenId={defaultOpenId}
              expandAll={expandAll}
            />
          ))}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

function PhaseSection({
  phase,
  defaultOpenId,
  expandAll,
}: {
  phase: TimelinePhase;
  defaultOpenId: string | null;
  expandAll: boolean;
}) {
  return (
    <section className={["space-y-2", phase.future ? "opacity-70" : ""].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-3">
        <h3 className="shrink-0 text-sm font-semibold text-foreground">{phase.title}</h3>
        <div className="h-px flex-1 bg-card-border" />
      </div>
      <div className="space-y-2">
        {phase.cards.map((card) => (
          <TimelineCardView
            key={card.id}
            card={card}
            defaultOpen={expandAll || card.id === defaultOpenId}
          />
        ))}
      </div>
    </section>
  );
}

function TimelineCardView({ card, defaultOpen }: { card: TimelineCard; defaultOpen: boolean }) {
  const groups = buildTaskGroups(card.rows);
  const meta = cardMeta(card.rows);

  return (
    <AccordionRoot key={`${card.id}-${defaultOpen}`} defaultValue={defaultOpen ? [card.id] : []}>
      <AccordionItem
        value={card.id}
        className={["rounded-lg", card.future ? "border-dashed" : ""].filter(Boolean).join(" ")}
      >
        <AccordionHeader>
          <AccordionTrigger
            className="items-start px-3 py-2.5"
            trailing={<CardStateBadge state={card.state} />}
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="min-w-0 text-sm font-medium leading-5 text-foreground">{card.title}</p>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <p className="min-w-0 flex-1">{card.description}</p>
                {card.reviewId ? (
                  <span
                    data-review-id={card.reviewId}
                    role="button"
                    tabIndex={0}
                    className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ExternalLinkIcon className="size-3" />
                    details
                  </span>
                ) : null}
              </div>
              {card.rows.length > 0 ? (
                <p className="text-xs text-muted-foreground">{meta}</p>
              ) : null}
            </div>
          </AccordionTrigger>
        </AccordionHeader>

        <AccordionPanel>
          <div className="">
            {groups.map((group) => (
              <TaskGroupView key={group.id} group={group} />
            ))}
          </div>
        </AccordionPanel>
      </AccordionItem>
    </AccordionRoot>
  );
}

function TaskGroupView({ group }: { group: TaskGroup }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 bg-panel-muted px-3 py-1.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-secondary-foreground">
          {group.title}
        </p>
        <span className="text-xs font-semibold text-muted-foreground">{group.rows.length}</span>
      </div>
      <div className="divide-y divide-card-border/60 px-3">
        {group.rows.map((row) => (
          <TaskRow key={row.id} row={row} groupId={group.id} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ row, groupId }: { row: StageItem; groupId: TaskGroup["id"] }) {
  const isAuditMarker = row.reviewId !== undefined;
  // Audit markers route clicks to the review drawer instead of the task
  // drawer — they're a synthetic row, not a real task, and have nothing
  // useful to show in the task detail view.
  const dataAttr = isAuditMarker ? { "data-review-id": row.reviewId } : { "data-task-id": row.id };

  return (
    <button
      type="button"
      {...dataAttr}
      className="grid min-h-9 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-left transition-colors hover:bg-panel-muted/60"
      title={row.blockedReason ?? row.skipReason ?? row.title}
    >
      <TaskIndicator status={row.status} />
      <span className={itemTitleClass(row.status)}>{row.title}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {isAuditMarker ? (
          <Badge variant="subtle">audit</Badge>
        ) : (
          <>
            {row.triageState ? (
              <Badge variant={triageVariant(row.triageState)}>{row.triageState}</Badge>
            ) : null}
            {row.severity ? (
              <Badge variant={severityVariant(row.severity)}>{row.severity}</Badge>
            ) : null}
            <Badge variant="subtle">{row.effort}</Badge>
            {groupId !== "blocked" && row.status === "blocked" ? (
              <Badge variant="statusInProgress">blocked</Badge>
            ) : null}
            {groupId !== "skipped" && row.status === "skipped" ? (
              <Badge variant="outline">skipped</Badge>
            ) : null}
            {groupId !== "skipped" && row.status === "stopped" ? (
              <Badge variant="outline">stopped</Badge>
            ) : null}
          </>
        )}
      </span>
    </button>
  );
}

function CardStateBadge({ state }: { state: PhaseState }) {
  return <Badge variant={stateBadgeVariant(state)}>{state}</Badge>;
}

function buildTimelinePhases(cards: StageCard[]): TimelinePhase[] {
  const phaseMap = new Map<string, StageCard[]>();

  for (const card of cards) {
    const key = card.phaseNumber === null ? "initial" : `phase-${card.phaseNumber}`;
    const phaseCards = phaseMap.get(key) ?? [];
    phaseCards.push(card);
    phaseMap.set(key, phaseCards);
  }

  return [...phaseMap.entries()]
    .map(([id, phaseCards]) => buildTimelinePhase(id, phaseCards))
    .sort(comparePhasesDescending);
}

function buildTimelinePhase(id: string, cards: StageCard[]): TimelinePhase {
  const phaseNumber = cards.find((card) => card.phaseNumber !== null)?.phaseNumber ?? null;
  const baseCards = cards.filter((card) => card.kind !== "review");
  const agentReviews = cards.filter(
    (card) => card.kind === "review" && card.reviewType === "agent",
  );
  const humanReviews = cards.filter(
    (card) => card.kind === "review" && card.reviewType === "human",
  );

  // From the user's POV, agent audits are an implementation detail of the
  // coder/auditor loop — they don't need their own visual representation.
  // Their findings are tasks; fold them into the phase work card alongside
  // base tasks so the timeline reads as "here is the work being done", not
  // "here is the loop machinery". Human reviews still surface as their own
  // card because they represent explicit user feedback, not internal audit
  // cycles.
  const workRows = [
    ...baseCards.flatMap((card) => card.items),
    ...agentReviews.flatMap((card) => card.items),
  ];
  const future = isFutureTimelinePhase({ baseCards, humanReviews, rows: workRows });
  const current = cards.some((card) => card.current);

  return {
    id,
    phaseNumber,
    title: phaseNumber === null ? "Initial run" : `Phase ${phaseNumber}`,
    description: phaseDescription({ current, future, rows: workRows }),
    future,
    cards: [
      {
        id: `${id}-work`,
        title: phaseWorkTitle(phaseNumber, future),
        description: workCardDescription(workRows),
        state: phaseWorkState({ current, future, rows: workRows }),
        current: current && !humanReviews.some((review) => review.current),
        future,
        reviewId: null,
        sortAt: latestStageDate([...baseCards, ...agentReviews]),
        rows: workRows,
      },
      ...humanReviews.map((review, index) => ({
        id: review.id,
        title: `Reviewer feedback${humanReviews.length > 1 ? ` #${index + 1}` : ""}`,
        description: humanReviewDescription(review),
        state: humanReviewState(review),
        current: review.current,
        future: review.future,
        reviewId: review.review?.id ?? null,
        sortAt: review.createdAt,
        rows: review.items,
      })),
    ]
      .filter((card) => card.rows.length > 0 || card.reviewId !== null)
      .sort(compareTimelineCardsDescending),
  };
}

function phaseWorkTitle(phaseNumber: number | null, future: boolean): string {
  if (future) {
    return "Planned implementation";
  }

  if (phaseNumber === null) {
    return "Initial implementation";
  }

  return "Implementation";
}

function isFutureTimelinePhase({
  baseCards,
  humanReviews,
  rows,
}: {
  baseCards: StageCard[];
  humanReviews: StageCard[];
  rows: StageItem[];
}): boolean {
  return (
    baseCards.length > 0 &&
    baseCards.every((card) => card.future) &&
    humanReviews.length === 0 &&
    rows.length > 0 &&
    rows.every((row) => row.status === "pending" || row.status === "skipped")
  );
}

function comparePhasesDescending(a: TimelinePhase, b: TimelinePhase): number {
  if (a.phaseNumber === null && b.phaseNumber === null) {
    return 0;
  }

  if (a.phaseNumber === null) {
    return 1;
  }

  if (b.phaseNumber === null) {
    return -1;
  }

  return b.phaseNumber - a.phaseNumber;
}

function compareTimelineCardsDescending(a: TimelineCard, b: TimelineCard): number {
  return timestampValue(b.sortAt) - timestampValue(a.sortAt);
}

function latestStageDate(cards: StageCard[]): string | null {
  let latest: string | null = null;
  for (const card of cards) {
    if (!latest || timestampValue(card.createdAt) > timestampValue(latest)) {
      latest = card.createdAt;
    }
  }

  return latest;
}

function timestampValue(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

function buildTaskGroups(rows: StageItem[]): TaskGroup[] {
  return [
    {
      id: "running",
      title: "Running",
      rows: rows.filter((row) => row.status === "in_progress"),
    },
    {
      id: "blocked",
      title: "Blocked",
      rows: rows.filter((row) => row.status === "blocked"),
    },
    {
      id: "todo",
      title: "To do",
      rows: rows.filter((row) => row.status === "pending"),
    },
    {
      id: "passed",
      title: "Passed",
      rows: rows.filter((row) => row.status === "done"),
    },
    {
      id: "skipped",
      title: "Skipped",
      rows: rows.filter((row) => row.status === "skipped" || row.status === "stopped"),
    },
  ].filter((group) => group.rows.length > 0);
}

function phaseWorkState({
  current,
  future,
  rows,
}: {
  current: boolean;
  future: boolean;
  rows: StageItem[];
}): PhaseState {
  // Treat `skipped` as a non-starting state alongside `pending`: a PRD that
  // was made ready with some tasks pre-skipped shouldn't flip to "coding"
  // until something actually runs (`in_progress`, `blocked`, `done`).
  if (future || rows.every((row) => row.status === "pending" || row.status === "skipped")) {
    return "pending";
  }

  if (rows.every((row) => isClosed(row))) {
    return "done";
  }

  if (current || rows.some((row) => !isClosed(row))) {
    return "coding";
  }

  return "done";
}

function humanReviewState(card: StageCard): PhaseState {
  if (card.review?.status !== "done") {
    return "reviewing";
  }

  if (card.items.some((item) => !isClosed(item))) {
    return "coding";
  }

  return "done";
}

function phaseDescription({
  current,
  future,
  rows,
}: {
  current: boolean;
  future: boolean;
  rows: StageItem[];
}) {
  if (future) {
    return "Planned work";
  }

  if (current || rows.some((row) => row.status === "in_progress")) {
    return "Current work";
  }

  return "Completed work";
}

function workCardDescription(rows: StageItem[]): string {
  const taskCount = rows.length;
  return `${taskCount} task${taskCount === 1 ? "" : "s"}`;
}

function humanReviewDescription(card: StageCard): string {
  const count = card.items.length;
  if (card.review?.status !== "done") {
    return `${count} review finding${count === 1 ? "" : "s"} waiting for feedback`;
  }

  return `${count} review finding${count === 1 ? "" : "s"} resolved`;
}

function cardMeta(rows: StageItem[]): string {
  const visible = rows.filter((row) => row.status !== "skipped" && row.status !== "stopped");
  const doneCount = visible.filter((row) => row.status === "done").length;
  const blockedCount = visible.filter((row) => row.status === "blocked").length;
  const runningCount = visible.filter((row) => row.status === "in_progress").length;
  const parts = [`${doneCount} / ${visible.length} done`];

  if (runningCount > 0) {
    parts.push(`${runningCount} running`);
  }

  if (blockedCount > 0) {
    parts.push(`${blockedCount} blocked`);
  }

  return parts.join(" - ");
}

function isClosed(item: StageItem): boolean {
  return item.status === "done" || item.status === "skipped" || item.status === "stopped";
}

function stateBadgeVariant(state: PhaseState): React.ComponentProps<typeof Badge>["variant"] {
  if (state === "done") {
    return "statusDone";
  }

  if (state === "reviewing") {
    return "severityInfo";
  }

  if (state === "coding") {
    return "statusInProgress";
  }

  return "statusReady";
}

function itemTitleClass(status: StageItem["status"]) {
  if (status === "done") {
    return "truncate text-sm text-muted-foreground line-through";
  }

  if (status === "in_progress") {
    return "truncate text-sm font-semibold text-foreground";
  }

  if (status === "blocked") {
    return "truncate text-sm font-medium text-warning-foreground";
  }

  if (status === "skipped" || status === "stopped") {
    return "truncate text-sm text-muted-foreground line-through";
  }

  return "truncate text-sm text-secondary-foreground";
}

function severityVariant(severity: NonNullable<StageItem["severity"]>) {
  if (severity === "critical") {
    return "severityCritical" as const;
  }

  if (severity === "major") {
    return "severityMajor" as const;
  }

  if (severity === "minor") {
    return "severityMinor" as const;
  }

  return "severityInfo";
}

function triageVariant(
  triageState: NonNullable<StageItem["triageState"]>,
): React.ComponentProps<typeof Badge>["variant"] {
  // `ready-for-agent` is the actionable state — render it with the distinct
  // positive variant. Every other triage state (needs-triage / needs-info /
  // ready-for-human / wontfix) reads as "not to take now" and shares the muted
  // info variant.
  return triageState === "ready-for-agent" ? "triageReady" : "triageParked";
}
