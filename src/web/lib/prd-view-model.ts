import type { PrdDetailResponse, PrdListResponse } from "#/web/lib/api-types";

type ListPrd = PrdListResponse["prds"][number];
type DetailPrd = PrdDetailResponse["prd"];
type DetailTask = PrdDetailResponse["tasks"][number];
type DetailReview = PrdDetailResponse["reviews"][number];
type DetailActivity = PrdDetailResponse["activity"][number];

export type BoardColumnId = "draft" | "ready" | "in_progress" | "review" | "done" | "canceled";

export type BoardCardTask = {
  id: string;
  title: string;
  status: DetailTask["status"];
};

export type BoardCard = {
  id: string;
  prdId: string;
  projectId: string;
  projectName: string | null;
  title: string;
  context: string | null;
  status: ListPrd["status"];
  updatedAt: ListPrd["updatedAt"];
  totalTasks: number;
  doneTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  skippedTasks: number;
  latestReview: ListPrd["latestReview"];
  previewTasks: BoardCardTask[];
  footerLabel: string;
  animatedLabel: string | null;
};

export type BoardColumn = {
  id: BoardColumnId;
  title: string;
  cards: BoardCard[];
};

export type StageItem = {
  id: string;
  title: string;
  status: DetailTask["status"] | "stopped";
  effort: DetailTask["effort"];
  severity: DetailTask["severity"];
  createdAt: DetailTask["createdAt"];
  startedAt: DetailTask["startedAt"];
  completedAt: DetailTask["completedAt"];
  blockedReason: DetailTask["blockedReason"];
  skipReason: DetailTask["skipReason"];
  /**
   * Set when the item is a synthetic marker for an audit review (not a real
   * task). The row will route clicks to the review drawer instead of the task
   * drawer, and the renderer can hide task-specific affordances.
   */
  reviewId?: string;
};

export type StageCard = {
  id: string;
  kind: "initial" | "phase" | "review";
  title: string;
  meta: string;
  items: StageItem[];
  review?: DetailReview;
  reviewType?: DetailReview["type"];
  phaseNumber: number | null;
  createdAt: DetailPrd["createdAt"];
  current: boolean;
  complete: boolean;
  future: boolean;
  canceled: boolean;
};

export type RevisionEntry = {
  id: string;
  revision: number;
  status: DetailPrd["status"];
  createdAt: DetailPrd["createdAt"];
  isHead: boolean;
  isCurrentView: boolean;
  superseded: boolean;
};

export type DetailSummary = {
  totalTasks: number;
  doneTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  skippedTasks: number;
  activeReview: DetailReview | null;
  currentCycleLabel: string | null;
};

export function resolvePrdDisplayStatus(
  prd: DetailPrd,
  activeReview: DetailReview | null,
): DetailPrd["status"] | "review" {
  if (
    prd.status === "in_progress" &&
    activeReview?.type === "human" &&
    activeReview.status !== "done"
  ) {
    return "review";
  }

  return prd.status;
}

type DetailData = {
  prd: DetailPrd;
  tasks: DetailTask[];
  reviews: DetailReview[];
  revisions: PrdDetailResponse["revisions"];
  activity: DetailActivity[];
};

export function buildBoardColumns(prds: ListPrd[]): BoardColumn[] {
  const columns: BoardColumn[] = [
    { id: "draft", title: "Backlog", cards: [] },
    { id: "ready", title: "Todo", cards: [] },
    { id: "in_progress", title: "In Progress", cards: [] },
    { id: "review", title: "Review", cards: [] },
    { id: "done", title: "Done", cards: [] },
    { id: "canceled", title: "Canceled", cards: [] },
  ];

  for (const prd of prds) {
    const card = buildBoardCard(prd);
    const column = columns.find((item) => item.id === resolveBoardColumn(prd));
    column?.cards.push(card);
  }

  return columns;
}

function buildBoardCard(prd: ListPrd): BoardCard {
  return {
    id: prd.id,
    prdId: prd.prdId,
    projectId: prd.projectId,
    projectName: prd.projectName ?? null,
    title: prd.title,
    context: prd.context,
    status: prd.status,
    updatedAt: prd.updatedAt,
    totalTasks: prd.totalTasks,
    doneTasks: prd.doneTasks,
    blockedTasks: prd.blockedTasks,
    inProgressTasks: prd.inProgressTasks,
    skippedTasks: prd.skippedTasks,
    latestReview: prd.latestReview,
    previewTasks: prd.previewTasks,
    footerLabel: buildBoardFooterLabel(prd),
    animatedLabel: buildAnimatedLabel(prd),
  };
}

function resolveBoardColumn(prd: ListPrd): BoardColumnId {
  if (prd.status === "done") {
    return "done";
  }

  if (prd.status === "canceled") {
    return "canceled";
  }

  // Explicit `review` status — the dev orchestrator parked the PRD here
  // pending human validation. Takes precedence over any other heuristic.
  if (prd.status === "review") {
    return "review";
  }

  // Legacy fallback: PRDs created before the explicit `review` status
  // existed signalled the same intent by leaving the latest human review
  // open while the PRD itself stayed `in_progress`. Keep the heuristic
  // alive so historical data still groups correctly.
  if (
    prd.status === "in_progress" &&
    prd.latestReview?.type === "human" &&
    prd.latestReview.status !== "done"
  ) {
    return "review";
  }

  return prd.status;
}

function buildAnimatedLabel(prd: ListPrd): string | null {
  // PRDs explicitly parked in the human-review gate shouldn't animate as
  // "writing" — they are waiting on a human, the agents are idle.
  if (prd.status === "review") {
    return "Awaiting review";
  }

  if (prd.status !== "in_progress") {
    return null;
  }

  if (prd.latestReview && prd.latestReview.status !== "done") {
    return prd.latestReview.type === "human" ? null : "Auditing";
  }

  if (prd.blockedTasks > 0) {
    return "Resolving";
  }

  if (prd.latestReview && prd.latestReview.findingsCount > 0) {
    return prd.latestReview.type === "human" ? "Addressing review" : "Addressing audit";
  }

  return "Writing";
}

function buildBoardFooterLabel(prd: ListPrd): string {
  if (prd.status === "done") {
    return "Completed";
  }

  if (prd.status === "canceled") {
    return "Canceled";
  }

  if (prd.latestReview && prd.latestReview.status !== "done") {
    return prd.latestReview.type === "human" ? "Awaiting human review" : "Agent audit in progress";
  }

  if (prd.status === "in_progress" && prd.latestReview && prd.latestReview.findingsCount > 0) {
    return prd.latestReview.type === "human"
      ? "in progress · addressing review"
      : "in progress · addressing audit";
  }

  return prd.status.replace("_", " ");
}

export function buildDetailSummary({ prd, tasks, reviews }: DetailData): DetailSummary {
  const summary = {
    totalTasks: tasks.length,
    doneTasks: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    blockedTasks: 0,
    skippedTasks: 0,
  };

  for (const task of tasks) {
    if (task.status === "done") {
      summary.doneTasks++;
    } else if (task.status === "pending") {
      summary.pendingTasks++;
    } else if (task.status === "in_progress") {
      summary.inProgressTasks++;
    } else if (task.status === "blocked") {
      summary.blockedTasks++;
    } else if (task.status === "skipped") {
      summary.skippedTasks++;
      summary.doneTasks++;
    }
  }

  const activeReview = [...reviews].reverse().find((review) => review.status !== "done") ?? null;

  return {
    ...summary,
    activeReview,
    currentCycleLabel: buildCurrentCycleLabel({ prd, reviews, tasks }),
  };
}

export function buildStageCards(data: DetailData): StageCard[] {
  const baseTaskCards = buildBaseTaskStageCards(data);
  const reviewCards: StageCard[] = [];

  // For phased PRDs, pin unphased agent reviews to the most plausible phase
  // so their findings don't pollute an unrelated phase's task list and the
  // unphased audit doesn't render as a stray "Initial run" section.
  //
  // Heuristic: prefer `prd.currentPhase` when set; otherwise the lowest phase
  // that still has open work (any task not done or skipped). For a PRD with
  // all phases finished, fall back to the highest phase number so the audit
  // shows on the last phase the user saw active. Using max(phaseNumbers)
  // here was wrong — done findings ended up under the not-yet-started phase
  // 3 instead of the active phase 2.
  const phaseNumbers = baseTaskCards
    .map((card) => card.phaseNumber)
    .filter((n): n is number => n !== null);
  const isPhased = phaseNumbers.length > 0;
  const reviewFallbackPhase = isPhased
    ? (data.prd.currentPhase ?? deriveActivePhase(data.tasks, phaseNumbers))
    : null;

  for (const [index, review] of data.reviews.entries()) {
    const cycleNumber = review.phaseNumber ?? index + 1;
    const findings = review.findings.map((task) =>
      toStageItem(task, data.prd.status === "canceled"),
    );
    const resolvedPhase =
      review.phaseNumber ??
      (review.type === "agent" && reviewFallbackPhase !== null ? reviewFallbackPhase : null);

    // Surface each agent audit as a single synthetic task line ("Agent audit
    // #N") so the user knows the audit happened without having to read its
    // findings. Human reviews don't get a marker — they render as their own
    // "Reviewer feedback" card.
    const auditMarker: StageItem | null =
      review.type === "agent"
        ? {
            id: `audit-${review.id}`,
            title: `Agent audit #${cycleNumber}`,
            status: agentReviewToTaskStatus(review.status),
            effort: "s",
            severity: null,
            createdAt: review.createdAt,
            startedAt: review.createdAt,
            completedAt: review.doneAt,
            blockedReason: null,
            skipReason: null,
            reviewId: review.id,
          }
        : null;

    // For a properly phased agent audit, findings legitimately belong to the
    // same phase as the audited work — fold them into the phase work card.
    // For an UNphased agent audit, findings have no real home: pinning them
    // to any one phase makes that phase look like it has stray "done" tasks
    // (the bug repro on the Migration PRD). Hide them from the timeline; the
    // user can still drill in via the review drawer if they want details.
    const showFindingsOnTimeline = review.phaseNumber !== null || review.type === "human";
    const items = auditMarker
      ? showFindingsOnTimeline
        ? [auditMarker, ...findings]
        : [auditMarker]
      : findings;

    const reviewCard: StageCard = {
      id: `review-${review.id}`,
      kind: "review",
      title: `${review.type === "human" ? "Human Review" : "Agent Audit"} #${cycleNumber}`,
      meta: buildReviewMeta(review),
      items,
      review,
      reviewType: review.type,
      phaseNumber: resolvedPhase,
      createdAt: review.createdAt,
      current: false,
      complete: review.status === "done",
      future: false,
      canceled: false,
    };

    reviewCards.push(reviewCard);
  }

  const cards = combineStageCards(baseTaskCards, reviewCards).filter(
    (card) => card.items.length > 0,
  );

  markCurrentStage(cards, data);

  return orderStageCards(cards);
}

function buildBaseTaskStageCards(data: DetailData): StageCard[] {
  const initialTasks = data.tasks.filter((task) => task.reviewId === null);
  const phasedTasks = initialTasks.filter((task) => task.phaseNumber !== null);

  if (phasedTasks.length === 0) {
    return [
      {
        id: "initial-run",
        kind: "initial",
        title: "Initial run",
        meta: buildInitialMeta(initialTasks, data.prd.status),
        items: initialTasks.map((task) => toStageItem(task, data.prd.status === "canceled")),
        phaseNumber: null,
        createdAt: latestTaskDate(initialTasks) ?? data.prd.createdAt,
        current: false,
        complete: initialTasks.every((task) => task.status === "done" || task.status === "skipped"),
        future: false,
        canceled: data.prd.status === "canceled",
      },
    ];
  }

  const cards: StageCard[] = [];
  const unphasedTasks = initialTasks.filter((task) => task.phaseNumber === null);
  if (unphasedTasks.length > 0) {
    cards.push({
      id: "initial-run",
      kind: "initial",
      title: "Initial run",
      meta: buildInitialMeta(unphasedTasks, data.prd.status),
      items: unphasedTasks.map((task) => toStageItem(task, data.prd.status === "canceled")),
      phaseNumber: null,
      createdAt: latestTaskDate(unphasedTasks) ?? data.prd.createdAt,
      current: false,
      complete: unphasedTasks.every((task) => task.status === "done" || task.status === "skipped"),
      future: false,
      canceled: data.prd.status === "canceled",
    });
  }

  const phaseNumbers = [
    ...new Set(
      phasedTasks
        .map((task) => task.phaseNumber)
        .filter((phaseNumber): phaseNumber is number => phaseNumber !== null),
    ),
  ].sort((a, b) => a - b);

  for (const phaseNumber of phaseNumbers) {
    const phaseTasks = phasedTasks.filter((task) => task.phaseNumber === phaseNumber);
    cards.push({
      id: `phase-${phaseNumber}`,
      kind: "phase",
      title: `Phase ${phaseNumber}`,
      meta: buildInitialMeta(phaseTasks, data.prd.status),
      items: phaseTasks.map((task) => toStageItem(task, data.prd.status === "canceled")),
      phaseNumber,
      createdAt: latestTaskDate(phaseTasks) ?? data.prd.createdAt,
      current: false,
      complete: phaseTasks.every((task) => task.status === "done" || task.status === "skipped"),
      future:
        isFuturePhase(data.prd, phaseNumber) &&
        phaseTasks.every((task) => task.status === "pending"),
      canceled: data.prd.status === "canceled",
    });
  }

  return cards;
}

function combineStageCards(baseTaskCards: StageCard[], reviewCards: StageCard[]): StageCard[] {
  const hasPhaseCards = [...baseTaskCards, ...reviewCards].some(
    (card) => card.phaseNumber !== null,
  );

  if (!hasPhaseCards) {
    return [...baseTaskCards, ...reviewCards];
  }

  const phaseNumbers = [
    ...new Set(
      [...baseTaskCards, ...reviewCards]
        .map((card) => card.phaseNumber)
        .filter((phaseNumber): phaseNumber is number => phaseNumber !== null),
    ),
  ].sort((a, b) => a - b);

  const cards: StageCard[] = [];
  cards.push(...baseTaskCards.filter((card) => card.phaseNumber === null));

  for (const phaseNumber of phaseNumbers) {
    const baseCard = baseTaskCards.find((card) => card.phaseNumber === phaseNumber);
    if (baseCard) {
      cards.push(baseCard);
    }
    cards.push(...reviewCards.filter((card) => card.phaseNumber === phaseNumber));
  }

  cards.push(...reviewCards.filter((card) => card.phaseNumber === null));
  return cards;
}

function markCurrentStage(cards: StageCard[], data: DetailData): void {
  // Only HUMAN reviews can pre-empt the active phase: a human review in
  // flight is a real handoff that the user has to act on, so it should be
  // the visual anchor. Agent audits are background work — they don't change
  // where the timeline points to.
  const activeHumanReview = [...data.reviews]
    .reverse()
    .find((review) => review.status !== "done" && review.type === "human");
  const activeReviewCard = activeHumanReview
    ? cards.find((card) => card.review?.id === activeHumanReview.id)
    : null;
  if (activeReviewCard) {
    activeReviewCard.current = true;
    return;
  }

  if (data.prd.status !== "done" && data.prd.status !== "canceled") {
    // Pre-activation PRDs don't have a real `currentPhase` yet — treat the
    // first phase as the implicit "next to run" so it surfaces as the active
    // phase instead of being lost in the timeline ordering.
    const targetPhase = data.prd.currentPhase ?? 1;
    const currentPhaseCard = cards.find((card) => card.phaseNumber === targetPhase);
    if (currentPhaseCard) {
      currentPhaseCard.current = true;
      return;
    }
  }

  const latestCard = cards.at(-1);
  if (latestCard) {
    latestCard.current = true;
  }
}

function orderStageCards(cards: StageCard[]): StageCard[] {
  const currentCards = cards.filter((card) => card.current);
  const futureCards = cards
    .filter((card) => card.future && !card.current)
    .sort((a, b) => (a.phaseNumber ?? 0) - (b.phaseNumber ?? 0));
  const previousCards = cards.filter((card) => !card.current && !card.future).reverse();

  return [...currentCards, ...futureCards, ...previousCards];
}

function isFuturePhase(prd: DetailPrd, phaseNumber: number): boolean {
  // In draft / ready the PRD is still being planned: every phase is equally
  // "to come", so nothing should be flagged future. This keeps the
  // `FuturePhases` accordion empty (and unmounted) so the reader sees all
  // phases at the same visual level instead of having to expand a section.
  if (prd.status === "draft" || prd.status === "ready") {
    return false;
  }
  if (prd.status === "done" || prd.status === "canceled") {
    return false;
  }
  // Once activated, only phases strictly after the current one are future.
  if (prd.currentPhase !== null && prd.currentPhase !== undefined) {
    return phaseNumber > prd.currentPhase;
  }
  // Activated PRD without an explicit currentPhase: phase 1 is the implicit
  // "next current", everything beyond it is future and should fold into the
  // "Future phases" collapsible instead of cluttering the timeline.
  return phaseNumber > 1;
}

export function buildRevisionEntries(data: DetailData): RevisionEntry[] {
  const headId = data.revisions.at(-1)?.id ?? data.prd.id;

  return [...data.revisions].reverse().map((revision) => ({
    id: revision.id,
    revision: revision.revision,
    status: revision.status,
    createdAt: revision.createdAt,
    isHead: revision.id === headId,
    isCurrentView: revision.id === data.prd.id,
    superseded: revision.supersededAt !== null,
  }));
}

function buildCurrentCycleLabel({
  prd,
  reviews,
  tasks,
}: Pick<DetailData, "prd" | "reviews" | "tasks">) {
  if (prd.status === "done" || prd.status === "canceled") {
    return null;
  }

  const lastReview = reviews.at(-1);
  if (!lastReview) {
    return "Initial run";
  }

  if (lastReview.status !== "done") {
    return `${lastReview.type === "human" ? "Human Review" : "Agent Audit"} #${lastReview.phaseNumber ?? reviews.length}`;
  }

  const openFindings = lastReview.findings.filter(
    (task) => task.status !== "done" && task.status !== "skipped",
  );

  if (openFindings.length > 0) {
    return `${lastReview.type === "human" ? "Human Review" : "Agent Audit"} #${lastReview.phaseNumber ?? reviews.length}`;
  }

  const activeBaseTask = tasks.find(
    (task) => task.reviewId === null && task.status === "in_progress",
  );
  if (activeBaseTask) {
    return "Initial run";
  }

  return "Initial run";
}

function deriveActivePhase(tasks: DetailTask[], phaseNumbers: number[]): number {
  const sorted = [...phaseNumbers].sort((a, b) => a - b);
  // Prefer a phase that is mid-flight (has in_progress or blocked work).
  for (const phase of [...sorted].reverse()) {
    const isMidFlight = tasks.some(
      (t) =>
        t.phaseNumber === phase &&
        t.reviewId === null &&
        (t.status === "in_progress" || t.status === "blocked"),
    );
    if (isMidFlight) return phase;
  }
  // Otherwise pick the highest phase whose work has at least been started or
  // finished — that's the most recently active phase. An unphased audit is
  // most plausibly about *that* work, not the next pending phase.
  for (const phase of [...sorted].reverse()) {
    const hasTouchedWork = tasks.some(
      (t) =>
        t.phaseNumber === phase &&
        t.reviewId === null &&
        (t.status === "done" || t.status === "skipped"),
    );
    if (hasTouchedWork) return phase;
  }
  // Nothing started yet — point at the first phase (the one that will start
  // first when the PRD activates).
  return sorted[0] ?? 1;
}

function agentReviewToTaskStatus(status: DetailReview["status"]): StageItem["status"] {
  if (status === "done") return "done";
  if (status === "in_progress") return "in_progress";
  return "pending";
}

function toStageItem(task: DetailTask, canceled: boolean): StageItem {
  if (canceled && task.status === "in_progress") {
    return {
      id: task.id,
      title: task.title,
      status: "stopped",
      effort: task.effort,
      severity: task.severity,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      blockedReason: task.blockedReason,
      skipReason: task.skipReason,
    };
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    effort: task.effort,
    severity: task.severity,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    blockedReason: task.blockedReason,
    skipReason: task.skipReason,
  };
}

function latestTaskDate(tasks: DetailTask[]): DetailTask["createdAt"] | null {
  let latest: DetailTask["createdAt"] | null = null;
  for (const task of tasks) {
    if (!latest || Date.parse(task.createdAt) > Date.parse(latest)) {
      latest = task.createdAt;
    }
  }

  return latest;
}

function buildInitialMeta(tasks: DetailTask[], prdStatus: DetailPrd["status"]): string {
  const doneCount = tasks.filter(
    (task) => task.status === "done" || task.status === "skipped",
  ).length;
  if (prdStatus === "canceled") {
    return `${doneCount} / ${tasks.length} done · canceled`;
  }

  if (doneCount === 0 && tasks.every((task) => task.status === "pending")) {
    return `0 / ${tasks.length} done · never started`;
  }

  return `${doneCount} / ${tasks.length} done`;
}

function buildReviewMeta(review: DetailReview): string {
  return `${review.findings.length} findings${review.doneAt ? " · Closed" : ""}`;
}
