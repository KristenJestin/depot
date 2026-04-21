import type { Database } from "#/db/client";
import { getContextTemplate } from "#/lib/contexts";
import { normalizeWorkspacePath } from "#/lib/paths";
import { getProject, getPrd, listActivity, listPrds, listTasks } from "#/lib/workflow";

export type ContextMode = "prd" | "dev" | "review";

type WorkspaceRecord = {
  id: string;
  projectId: string;
  path: string;
  label: string | null;
};

type ProjectRecord = {
  id: string;
  name: string;
  status: string;
};

type PrdRecord = {
  id: string;
  parentId: string | null;
  revision: number;
  title: string;
  context: string | null;
  scope: string | null;
  status: string;
  createdAt: string;
  committedAt: string | null;
  activatedAt: string | null;
};

type TaskRecord = {
  id: string;
  position: number;
  title: string;
  description: string;
  doneCriteria: string;
  dependsOn: string;
  effort: string;
  status: string;
  blockedReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

type ActivePrdResolution =
  | { kind: "none" }
  | { kind: "single"; prd: PrdRecord }
  | { kind: "conflict"; prds: PrdRecord[] };

const CONTEXT_SECTION_TITLES = {
  prd: {
    overview: "## Overview",
    prds: "## PRDs",
    instructions: "## Instructions",
  },
  dev: {
    standards: "## Standards",
    feedback: "## Feedback",
    activePrd: "## Active PRD",
    previousRevisions: "## Previous Revisions",
    progress: "## Progress",
    currentTask: "## Current Task",
    blockedTasks: "## Blocked Tasks",
    recentActivity: "## Recent Activity",
    nextRecommendedTask: "## Next Recommended Task",
    instructions: "## Instructions",
  },
  review: {
    overview: "## Overview",
    activePrd: "## Active PRD",
    tasksToReview: "## Tasks to Review",
    instructions: "## Instructions",
  },
} as const;

const CONTEXT_INDEX_SECTIONS: Array<{ mode: ContextMode; detail: string }> = [
  { mode: "prd", detail: "depot context prd" },
  { mode: "dev", detail: "depot context dev" },
  { mode: "review", detail: "depot context review" },
];

const DEV_PLACEHOLDERS = {
  standards: [
    "Standards are not modeled in depot yet.",
    "Placeholder: follow AGENTS.md, repository docs, and the existing codebase conventions.",
  ],
  feedback: [
    "Feedback is not modeled in depot yet.",
    "Placeholder: use activity logs, blocked tasks, and completed task outcomes as the current feedback loop.",
  ],
  noActivePrd: {
    activePrd: ["No active PRD found for this workspace."],
    previousRevisions: ["No archived revision chain is available because there is no active PRD."],
    progress: ["No active PRD means there is no task progress to summarize."],
    currentTask: ["No task in progress."],
    blockedTasks: ["No blocked tasks."],
    nextRecommendedTask: ["No recommended task because there is no active PRD."],
  },
} as const;

const REVIEW_PLACEHOLDERS = {
  noActivePrd: ["No active PRD found for this workspace."],
  noTasksToReview: ["No done tasks are ready to review because there is no active PRD."],
} as const;

const MODE_USAGE: Record<ContextMode, string> = {
  prd: "Frame product work and inspect the current PRD chain.",
  dev: "Load the live execution context for the active PRD.",
  review: "Load the live review context for completed work in the active PRD.",
};

export async function renderContextIndex(db: Database, workspaceId: string): Promise<string> {
  const header = await loadWorkspaceHeader(db, workspaceId);
  const prds = await listPrds(db, { workspaceId });
  const activeResolution = resolveActivePrd(prds);

  const lines: string[] = [];
  appendHeader(lines, "context", header.project, header.workspace);

  for (const section of CONTEXT_INDEX_SECTIONS) {
    lines.push(`## ${section.mode}`);
    lines.push(`Usage  : ${MODE_USAGE[section.mode]}`);
    lines.push(`Status : ${await buildIndexStatus(db, activeResolution, prds, section.mode)}`);
    lines.push(`Detail : ${section.detail}`);
    if (section.mode !== "review") {
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function renderContextMode(
  db: Database,
  workspaceId: string,
  mode: ContextMode,
): Promise<string> {
  switch (mode) {
    case "prd":
      return renderPrdContext(db, workspaceId);
    case "dev":
      return renderDevContext(db, workspaceId);
    case "review":
      return renderReviewContext(db, workspaceId);
  }
}

export function formatPathForDisplay(input: string): string {
  const normalizedInput = normalizeWorkspacePath(input);
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const normalizedHome = home ? normalizeWorkspacePath(home) : "";

  if (!normalizedHome) {
    return normalizedInput;
  }

  if (normalizedInput === normalizedHome) {
    return "~";
  }

  if (normalizedInput.startsWith(normalizedHome + "/")) {
    return `~${normalizedInput.slice(normalizedHome.length)}`;
  }

  return normalizedInput;
}

function appendHeader(
  lines: string[],
  mode: string,
  project: ProjectRecord,
  workspace: WorkspaceRecord,
): void {
  lines.push(`=== DEPOT CONTEXT — ${mode.toUpperCase()} ===`);
  lines.push(`Project   : ${project.name} (${project.id})`);
  lines.push(`Workspace : ${workspace.label ? `${workspace.label} — ` : ""}${formatPathForDisplay(workspace.path)}`);
  lines.push(`Generated : ${new Date().toISOString()}`);
  lines.push("");
}

async function loadWorkspaceHeader(db: Database, workspaceId: string) {
  const workspace = await db.query.workspaces.findFirst({ where: { id: workspaceId } });
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const project = await getProject(db, workspace.projectId);
  if (!project) {
    throw new Error(`Project not found: ${workspace.projectId}`);
  }

  return {
    workspace,
    project,
  };
}

async function renderPrdContext(db: Database, workspaceId: string): Promise<string> {
  const header = await loadWorkspaceHeader(db, workspaceId);
  const prds = sortPrdsNewestFirst((await listPrds(db, { workspaceId })).filter((prd) => prd.status !== "archived"));
  const template = getContextTemplate("prd").trim();
  const lines: string[] = [];

  appendHeader(lines, "prd", header.project, header.workspace);
  lines.push(CONTEXT_SECTION_TITLES.prd.overview);
  lines.push(MODE_USAGE.prd);

  const actionablePrd = prds.find((prd) => prd.status === "draft" || prd.status === "committed");
  if (actionablePrd) {
    lines.push(`Latest actionable PRD: run \`depot prd show ${actionablePrd.id}\` before editing this chain.`);
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.prd.prds);
  if (prds.length === 0) {
    lines.push("No non-archived PRDs found for this workspace.");
  } else {
    for (const prd of prds) {
      lines.push(`${prd.id}  ${prd.title}  [${prd.status}]  rev ${prd.revision}`);
    }
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.prd.instructions);
  lines.push(`Workspace path: ${formatPathForDisplay(header.workspace.path)}`);
  lines.push("");
  lines.push(template);

  return lines.join("\n");
}

async function renderDevContext(db: Database, workspaceId: string): Promise<string> {
  const header = await loadWorkspaceHeader(db, workspaceId);
  const prds = await listPrds(db, { workspaceId });
  const activeResolution = resolveActivePrd(prds);
  const template = getContextTemplate("dev").trim();
  const lines: string[] = [];

  appendHeader(lines, "dev", header.project, header.workspace);
  lines.push(CONTEXT_SECTION_TITLES.dev.standards);
  lines.push(...DEV_PLACEHOLDERS.standards);
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.feedback);
  lines.push(...DEV_PLACEHOLDERS.feedback);
  lines.push("");

  if (activeResolution.kind === "conflict") {
    throw new Error(buildActivePrdConflictMessage("dev", header.workspace, activeResolution.prds));
  }

  if (activeResolution.kind === "none") {
    lines.push(CONTEXT_SECTION_TITLES.dev.activePrd);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.activePrd);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.dev.previousRevisions);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.previousRevisions);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.dev.progress);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.progress);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.dev.currentTask);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.currentTask);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.dev.blockedTasks);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.blockedTasks);
    lines.push("");
    await appendRecentActivity(lines, db, header.project.id, workspaceId);
    lines.push(CONTEXT_SECTION_TITLES.dev.nextRecommendedTask);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.nextRecommendedTask);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.dev.instructions);
    lines.push(template);
    return lines.join("\n");
  }

  const activePrd = activeResolution.prd;
  const allTasks = await listTasks(db, activePrd.id);
  const previousRevisions = await loadArchivedRevisionChain(db, activePrd);

  lines.push(CONTEXT_SECTION_TITLES.dev.activePrd);
  lines.push(`${activePrd.id}  ${activePrd.title}  [${activePrd.status}]  rev ${activePrd.revision}`);
  if (activePrd.context) {
    lines.push(`Context : ${activePrd.context}`);
  }
  if (activePrd.scope) {
    lines.push(`Scope   : ${activePrd.scope}`);
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.previousRevisions);
  if (previousRevisions.length === 0) {
    lines.push("No archived revisions in this PRD chain.");
  } else {
    for (const revision of previousRevisions) {
      lines.push(`${revision.id}  ${revision.title}  [${revision.status}]  rev ${revision.revision}`);
    }
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.progress);
  lines.push(buildProgressSummary(allTasks));
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.currentTask);
  const currentTask = allTasks.find((task) => task.status === "in_progress");
  if (!currentTask) {
    lines.push("No task in progress.");
  } else {
    lines.push(`${currentTask.id}  ${currentTask.title}`);
    lines.push(`Started : ${currentTask.startedAt ?? "unknown"}`);
    lines.push("Criteria:");
    appendCriteria(lines, currentTask.doneCriteria);
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.blockedTasks);
  const blockedTasks = allTasks.filter((task) => task.status === "blocked");
  if (blockedTasks.length === 0) {
    lines.push("No blocked tasks.");
  } else {
    for (const task of blockedTasks) {
      lines.push(`${task.id}  ${task.title}`);
      lines.push(`Reason: ${task.blockedReason ?? "Blocked without a recorded reason"}`);
    }
  }
  lines.push("");

  await appendRecentActivity(lines, db, header.project.id, workspaceId);

  lines.push(CONTEXT_SECTION_TITLES.dev.nextRecommendedTask);
  const nextTask = findNextRecommendedTask(allTasks);
  if (!nextTask) {
    lines.push("No task is currently recommendable.");
  } else {
    lines.push(`${nextTask.id}  ${nextTask.title}`);
    lines.push(`Effort      : ${nextTask.effort}`);
    lines.push("Dependencies: satisfied");
    lines.push("Criteria:");
    appendCriteria(lines, nextTask.doneCriteria);
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.instructions);
  lines.push(template);
  return lines.join("\n");
}

async function renderReviewContext(db: Database, workspaceId: string): Promise<string> {
  const header = await loadWorkspaceHeader(db, workspaceId);
  const prds = await listPrds(db, { workspaceId });
  const activeResolution = resolveActivePrd(prds);
  const template = getContextTemplate("review").trim();
  const lines: string[] = [];

  appendHeader(lines, "review", header.project, header.workspace);

  if (activeResolution.kind === "conflict") {
    throw new Error(buildActivePrdConflictMessage("review", header.workspace, activeResolution.prds));
  }

  lines.push(CONTEXT_SECTION_TITLES.review.overview);
  lines.push(MODE_USAGE.review);
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.review.activePrd);
  if (activeResolution.kind === "none") {
    lines.push(...REVIEW_PLACEHOLDERS.noActivePrd);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.review.tasksToReview);
    lines.push(...REVIEW_PLACEHOLDERS.noTasksToReview);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.review.instructions);
    lines.push(template);
    return lines.join("\n");
  }

  const activePrd = activeResolution.prd;
  lines.push(`${activePrd.id}  ${activePrd.title}  [${activePrd.status}]  rev ${activePrd.revision}`);
  lines.push(`Context : ${activePrd.context ?? "No PRD context recorded."}`);
  lines.push(`Scope   : ${activePrd.scope ?? "No PRD scope recorded."}`);
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.review.tasksToReview);
  const doneTasks = (await listTasks(db, activePrd.id)).filter((task) => task.status === "done");
  if (doneTasks.length === 0) {
    lines.push(`No done tasks are ready to review for active PRD ${activePrd.id}.`);
  } else {
    for (const task of doneTasks) {
      lines.push(`${task.id}  #${task.position}  ${task.title}`);
      lines.push(`Completed : ${task.completedAt ?? "unknown"}`);
      lines.push("Criteria:");
      appendCriteria(lines, task.doneCriteria);
    }
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.review.instructions);
  lines.push(template);
  return lines.join("\n");
}

async function buildIndexStatus(
  db: Database,
  activeResolution: ActivePrdResolution,
  prds: PrdRecord[],
  mode: ContextMode,
): Promise<string> {
  switch (mode) {
    case "prd":
      return buildIndexPrdStatus(prds);
    case "dev":
      return buildIndexDevStatus(db, activeResolution);
    case "review":
      return buildIndexReviewStatus(db, activeResolution);
  }
}

function buildIndexPrdStatus(prds: PrdRecord[]): string {
  const nonArchived = sortPrdsNewestFirst(prds.filter((prd) => prd.status !== "archived"));
  if (nonArchived.length === 0) {
    return "No non-archived PRDs in this workspace yet.";
  }

  const latest = nonArchived[0]!;
  return `${nonArchived.length} non-archived PRD(s). Latest: ${latest.id} [${latest.status}] rev ${latest.revision}.`;
}

async function buildIndexDevStatus(
  db: Database,
  activeResolution: ActivePrdResolution,
): Promise<string> {
  if (activeResolution.kind === "conflict") {
    return `Conflict: multiple active PRDs (${activeResolution.prds.map((prd) => prd.id).join(", ")}).`;
  }

  if (activeResolution.kind === "none") {
    return "No active PRD.";
  }

  const tasks = await listTasks(db, activeResolution.prd.id);
  const doneCount = tasks.filter((task) => task.status === "done").length;
  const currentTask = tasks.find((task) => task.status === "in_progress");
  return `Active PRD ${activeResolution.prd.id}. ${doneCount}/${tasks.length} task(s) done. Current task: ${currentTask?.id ?? "none"}.`;
}

async function buildIndexReviewStatus(
  db: Database,
  activeResolution: ActivePrdResolution,
): Promise<string> {
  if (activeResolution.kind === "conflict") {
    return `Conflict: multiple active PRDs (${activeResolution.prds.map((prd) => prd.id).join(", ")}).`;
  }

  if (activeResolution.kind === "none") {
    return "No active PRD.";
  }

  const doneTasks = (await listTasks(db, activeResolution.prd.id)).filter((task) => task.status === "done");
  return `${doneTasks.length} done task(s) ready for review in PRD ${activeResolution.prd.id}.`;
}

function resolveActivePrd(prds: PrdRecord[]): ActivePrdResolution {
  const activePrds = sortPrdsNewestFirst(prds.filter((prd) => prd.status === "in_progress"));
  if (activePrds.length === 0) {
    return { kind: "none" };
  }
  if (activePrds.length > 1) {
    return { kind: "conflict", prds: activePrds };
  }
  return { kind: "single", prd: activePrds[0]! };
}

async function loadArchivedRevisionChain(db: Database, startingPrd: PrdRecord): Promise<PrdRecord[]> {
  const revisions: PrdRecord[] = [];
  let cursor = startingPrd.parentId;

  while (cursor) {
    const prd = await getPrd(db, cursor);
    if (!prd) {
      break;
    }
    if (prd.status === "archived") {
      revisions.push(prd);
    }
    cursor = prd.parentId;
  }

  return revisions;
}

async function appendRecentActivity(
  lines: string[],
  db: Database,
  projectId: string,
  workspaceId: string,
): Promise<void> {
  lines.push(CONTEXT_SECTION_TITLES.dev.recentActivity);
  const activity = await listActivity(db, {
    projectId,
    workspaceId,
    limit: 10,
  });

  if (activity.length === 0) {
    lines.push("No recent activity for this workspace.");
    lines.push("");
    return;
  }

  lines.push("Last 10 entries for the current workspace:");
  for (const entry of activity) {
    const payload = JSON.parse(entry.payload) as Record<string, unknown>;
    lines.push(`${entry.createdAt}  ${entry.eventType}  ${summarizePayload(entry.eventType, payload)}`);
  }
  lines.push("");
}

function buildProgressSummary(tasks: TaskRecord[]): string {
  if (tasks.length === 0) {
    return "No tasks exist for the active PRD yet.";
  }

  const doneCount = tasks.filter((task) => task.status === "done").length;
  const inProgressCount = tasks.filter((task) => task.status === "in_progress").length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const pendingCount = tasks.filter((task) => task.status === "pending").length;
  const skippedCount = tasks.filter((task) => task.status === "skipped").length;

  return `${doneCount}/${tasks.length} done · ${inProgressCount} in progress · ${blockedCount} blocked · ${pendingCount} pending · ${skippedCount} skipped`;
}

function findNextRecommendedTask(tasks: TaskRecord[]): TaskRecord | null {
  const doneIds = new Set(tasks.filter((task) => task.status === "done").map((task) => task.id));

  for (const task of tasks) {
    if (task.status !== "pending") {
      continue;
    }

    const dependencies = JSON.parse(task.dependsOn) as string[];
    if (dependencies.every((depId) => doneIds.has(depId))) {
      return task;
    }
  }

  return null;
}

function appendCriteria(lines: string[], doneCriteria: string): void {
  for (const line of doneCriteria.split("\n")) {
    lines.push(`  - ${line}`);
  }
}

function sortPrdsNewestFirst<T extends { createdAt: string }>(prds: T[]): T[] {
  return [...prds].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function buildActivePrdConflictMessage(
  mode: ContextMode,
  workspace: WorkspaceRecord,
  prds: PrdRecord[],
): string {
  const lines = [
    `Multiple active PRDs found for workspace ${formatPathForDisplay(workspace.path)}.`,
    `Resolve this conflict before running \`depot context ${mode}\`.`,
  ];

  for (const prd of prds) {
    lines.push(`- ${prd.id}  ${prd.title}  [${prd.status}]  rev ${prd.revision}`);
  }

  return lines.join("\n");
}

function summarizePayload(eventType: string, payload: Record<string, unknown>): string {
  switch (eventType) {
    case "note":
      return String(payload.message ?? "");
    case "session_start":
      return String(payload.context ?? "New session");
    case "task_started":
    case "task_done":
      return String(payload.title ?? "");
    case "task_blocked":
    case "task_skipped":
      return `${payload.title ?? ""} ${payload.reason ?? ""}`.trim();
    case "prd_committed":
    case "prd_activated":
      return String(payload.title ?? "");
    case "prd_amended":
      return `rev ${payload.revision ?? "?"}`;
    case "handoff":
      return String(payload.context ?? "");
    case "error":
      return String(payload.message ?? "");
    default:
      return JSON.stringify(payload);
  }
}
