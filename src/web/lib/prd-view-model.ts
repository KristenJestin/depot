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

  for (const [index, review] of data.reviews.entries()) {
    const cycleNumber = review.phaseNumber ?? index + 1;
    const findings = review.findings.map((task) =>
      toStageItem(task, data.prd.status === "canceled"),
    );
    const reviewCard: StageCard = {
      id: `review-${review.id}`,
      kind: "review",
      title: `${review.type === "human" ? "Human Review" : "Agent Audit"} #${cycleNumber}`,
      meta: buildReviewMeta(review),
      items: findings,
      review,
      reviewType: review.type,
      phaseNumber: review.phaseNumber ?? null,
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
  const activeReview = [...data.reviews].reverse().find((review) => review.status !== "done");
  const activeReviewCard = activeReview
    ? cards.find((card) => card.review?.id === activeReview.id)
    : null;
  if (activeReviewCard) {
    activeReviewCard.current = true;
    return;
  }

  if (
    data.prd.status !== "done" &&
    data.prd.status !== "canceled" &&
    data.prd.currentPhase !== null &&
    data.prd.currentPhase !== undefined
  ) {
    const currentPhaseCard = cards.find((card) => card.phaseNumber === data.prd.currentPhase);
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
  return (
    prd.currentPhase !== null &&
    prd.currentPhase !== undefined &&
    phaseNumber > prd.currentPhase &&
    prd.status !== "done" &&
    prd.status !== "canceled"
  );
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
