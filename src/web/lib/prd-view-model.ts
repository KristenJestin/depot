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
  startedAt: DetailTask["startedAt"];
  completedAt: DetailTask["completedAt"];
  blockedReason: DetailTask["blockedReason"];
  skipReason: DetailTask["skipReason"];
};

export type StageCard = {
  id: string;
  kind: "initial" | "review" | "rework";
  title: string;
  meta: string;
  items: StageItem[];
  review?: DetailReview;
  current: boolean;
  complete: boolean;
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

  if (prd.status === "in_progress" && prd.latestReview && prd.latestReview.status !== "done") {
    return "review";
  }

  return prd.status;
}

function buildAnimatedLabel(prd: ListPrd): string | null {
  if (prd.status !== "in_progress") {
    return null;
  }

  if (prd.latestReview && prd.latestReview.status !== "done") {
    return "Reviewing";
  }

  if (prd.blockedTasks > 0) {
    return "Resolving";
  }

  if (prd.latestReview && prd.latestReview.findingsCount > 0) {
    return "Fixing";
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
    return "Awaiting review";
  }

  if (prd.status === "in_progress" && prd.latestReview && prd.latestReview.findingsCount > 0) {
    return "in progress · rework";
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
  const initialTasks = data.tasks.filter((task) => task.reviewId === null);
  const reviewCards: StageCard[] = [];

  for (const [index, review] of data.reviews.entries()) {
    const cycleNumber = review.phaseNumber ?? index + 1;
    const findings = review.findings.map((task) =>
      toStageItem(task, data.prd.status === "canceled"),
    );
    const reviewCard: StageCard = {
      id: `review-${review.id}`,
      kind: "review",
      title: `${review.type === "human" ? "Human" : "Agent"} Review #${cycleNumber}`,
      meta: buildReviewMeta(review),
      items: findings,
      review,
      current: false,
      complete: review.status === "done",
      canceled: false,
    };

    reviewCards.push(reviewCard);

    const reworkTasks = findings.filter(
      (task) => task.status !== "pending" || task.severity !== null,
    );
    if (reworkTasks.length > 0) {
      reviewCards.push({
        id: `rework-${review.id}`,
        kind: "rework",
        title: `Rework #${cycleNumber}`,
        meta: buildReworkMeta(reworkTasks, data.prd.status),
        items: reworkTasks,
        current: false,
        complete: reworkTasks.every((task) => task.status === "done" || task.status === "skipped"),
        canceled: data.prd.status === "canceled",
      });
    }
  }

  const cards = [
    {
      id: "initial-run",
      kind: "initial" as const,
      title: "Initial run",
      meta: buildInitialMeta(initialTasks, data.prd.status),
      items: initialTasks.map((task) => toStageItem(task, data.prd.status === "canceled")),
      current: false,
      complete: initialTasks.every((task) => task.status === "done" || task.status === "skipped"),
      canceled: data.prd.status === "canceled",
    },
    ...reviewCards,
  ].filter((card) => card.items.length > 0);

  const reversed = cards.reverse();
  if (reversed[0]) {
    reversed[0].current = true;
  }

  return reversed;
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

  const openFindings = lastReview.findings.filter(
    (task) => task.status !== "done" && task.status !== "skipped",
  );

  if (openFindings.length > 0) {
    return `Rework #${lastReview.phaseNumber ?? reviews.length}`;
  }

  const activeBaseTask = tasks.find(
    (task) => task.reviewId === null && task.status === "in_progress",
  );
  if (activeBaseTask) {
    return "Initial run";
  }

  if (lastReview.status !== "done") {
    return `${lastReview.type === "human" ? "Human" : "Agent"} Review #${lastReview.phaseNumber ?? reviews.length}`;
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
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    blockedReason: task.blockedReason,
    skipReason: task.skipReason,
  };
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

function buildReworkMeta(tasks: StageItem[], prdStatus: DetailPrd["status"]): string {
  const doneCount = tasks.filter(
    (task) => task.status === "done" || task.status === "skipped",
  ).length;
  if (prdStatus === "canceled") {
    return `${doneCount} / ${tasks.length} fixes · canceled`;
  }

  if (doneCount === tasks.length) {
    return `${doneCount} / ${tasks.length} fixes · Complete`;
  }

  return `${doneCount} / ${tasks.length} fixes`;
}
