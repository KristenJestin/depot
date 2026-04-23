import type { Database } from "#/db/client";
import type { WorkspaceRow, ProjectRow, PrdRow, TaskRow } from "#/db/schema";
import { getContextTemplate } from "#/modules/context/index";
import { formatDate, formatPathForDisplay } from "#/shared/utils";
import { summarizeTaskDescription } from "#/modules/tasks/spec";
import {
  buildWorkspaceStatus,
  findNextRecommendedTask,
  getProject,
  getWorkspace,
  listPrds,
  listPrdFamily,
  getPrd,
  listTasks,
  listReviews,
  listReviewTasks,
  getReview,
  summarizeActivityPayload,
  RECENT_ACTIVITY_LIMIT,
} from "#/lib/workflow";

export type ContextMode = "prd" | "dev" | "coder" | "auditor";

type ActivePrdResolution =
  | { kind: "none" }
  | { kind: "single"; prd: PrdRow }
  | { kind: "conflict"; prds: PrdRow[] };

export type PrdTargetResolution =
  | { kind: "found"; prd: PrdRow }
  | { kind: "ambiguous"; candidates: PrdRow[] }
  | { kind: "not_found" };

export type PrdLaunchability = { launchable: true } | { launchable: false; reason: string };

const CONTEXT_SECTION_TITLES = {
  prd: {
    overview: "## Overview",
    prds: "## PRDs",
    instructions: "## Instructions",
  },
  dev: {
    activePrd: "## Active PRD",
    progress: "## Progress",
    currentTask: "## Current Task",
    blockedTasks: "## Blocked Tasks",
    recentActivity: "## Recent Activity",
    nextRecommendedTask: "## Next Recommended Task",
    instructions: "## Instructions",
  },
  coder: {
    prd: "## PRD",
    tasks: "## Tasks",
    instructions: "## Instructions",
  },
  auditor: {
    prd: "## PRD",
    doneTasks: "## Done Tasks Since Last Audit",
    lastReview: "## Last Agent Review",
    instructions: "## Instructions",
  },
} as const;

const CONTEXT_INDEX_SECTIONS: Array<{ mode: ContextMode; detail: string }> = [
  { mode: "prd", detail: "depot context prd" },
  { mode: "dev", detail: "depot context dev" },
  { mode: "coder", detail: "depot context coder <prd-id>" },
  { mode: "auditor", detail: "depot context auditor <prd-id>" },
];

const DEV_PLACEHOLDERS = {
  noActivePrd: {
    activePrd: ["No active PRD found for this workspace."],
    progress: ["No active PRD means there is no task progress to summarize."],
    currentTask: ["No task in progress."],
    blockedTasks: ["No blocked tasks."],
    nextRecommendedTask: ["No recommended task because there is no active PRD."],
  },
} as const;

const MODE_USAGE: Record<ContextMode, string> = {
  prd: "Frame product work and inspect the current PRD chain.",
  dev: "Load the live execution context for the active PRD.",
  coder: "Load implementation context for a coder sub-agent.",
  auditor: "Load audit context for an auditor sub-agent.",
};

export async function renderContextIndex(db: Database, workspaceId: string): Promise<string> {
  const header = await loadWorkspaceHeader(db, workspaceId);
  const allProjectPrds = await listPrds(db, { projectId: header.project.id });
  const activeResolution = resolveActivePrd(
    allProjectPrds.filter((p) => p.workspaceId === workspaceId),
  );

  const lines: string[] = [];
  appendHeader(lines, "context", header.project, header.workspace);

  for (const section of CONTEXT_INDEX_SECTIONS) {
    lines.push(`## ${section.mode}`);
    lines.push(`Usage  : ${MODE_USAGE[section.mode]}`);
    lines.push(
      `Status : ${await buildIndexStatus(db, activeResolution, allProjectPrds, section.mode)}`,
    );
    lines.push(`Detail : ${section.detail}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function renderContextMode(
  db: Database,
  workspaceId: string,
  mode: ContextMode,
  prdTarget?: string,
  reviewId?: string,
): Promise<string> {
  switch (mode) {
    case "prd":
      return renderPrdContext(db, workspaceId, prdTarget);
    case "dev":
      return renderDevContext(db, workspaceId, prdTarget);
    case "coder":
      return renderCoderContext(db, workspaceId, prdTarget, reviewId);
    case "auditor":
      return renderAuditorContext(db, workspaceId, prdTarget);
  }
}

function appendHeader(
  lines: string[],
  mode: string,
  project: ProjectRow,
  workspace: WorkspaceRow,
): void {
  lines.push(`=== DEPOT CONTEXT — ${mode.toUpperCase()} ===`);
  lines.push(`Project   : ${project.name} (${project.id})`);
  lines.push(
    `Workspace : ${workspace.label ? `${workspace.label} — ` : ""}${formatPathForDisplay(workspace.path)}`,
  );
  lines.push(`Generated : ${new Date().toISOString()}`);
  lines.push("");
}

async function loadWorkspaceHeader(db: Database, workspaceId: string) {
  const workspace = await getWorkspace(db, workspaceId);
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

async function renderPrdContext(
  db: Database,
  workspaceId: string,
  prdId?: string,
): Promise<string> {
  const header = await loadWorkspaceHeader(db, workspaceId);
  const allProjectPrds = await listPrds(db, { projectId: header.project.id });
  const template = getContextTemplate("prd").trim();
  const lines: string[] = [];

  appendHeader(lines, "prd", header.project, header.workspace);

  if (prdId) {
    // Specific PRD provided
    const targetPrd = allProjectPrds.find((p) => p.id === prdId);
    if (!targetPrd) {
      throw new Error(`PRD not found: ${prdId}`);
    }
    if (
      targetPrd.status === "in_progress" ||
      targetPrd.status === "done" ||
      targetPrd.status === "canceled"
    ) {
      throw new Error(
        `PRD '${prdId}' is in status '${targetPrd.status}'. Cannot edit a PRD that is in_progress or beyond. ` +
          `Use \`depot prd fork\` to create a new revision if modifications are needed.`,
      );
    }

    lines.push(CONTEXT_SECTION_TITLES.prd.overview);
    if (targetPrd.status === "ready") {
      lines.push(
        `PRD ${targetPrd.id} is 'ready'. A fork (v${targetPrd.revision + 1}) will be created to resume editing.`,
      );
    } else {
      lines.push(
        `Continuing Q&A for PRD ${targetPrd.id} [${targetPrd.status}] rev ${targetPrd.revision}.`,
      );
    }
    lines.push("");

    // Show family chain
    if (targetPrd.rootId) {
      const family = await listPrdFamily(db, targetPrd.rootId);
      if (family.length > 1) {
        lines.push(CONTEXT_SECTION_TITLES.prd.prds);
        lines.push("Revision chain:");
        for (const p of family) {
          const marker = p.id === prdId ? " ◄ current" : "";
          lines.push(`  ${p.id}  ${p.title}  [${p.status}]  rev ${p.revision}${marker}`);
        }
        lines.push("");
      }
    }

    lines.push(CONTEXT_SECTION_TITLES.prd.instructions);
    lines.push(`Workspace path: ${formatPathForDisplay(header.workspace.path)}`);
    lines.push("");
    lines.push(template);
    return lines.join("\n");
  }

  // No specific PRD — default behavior
  const prds = sortPrdsNewestFirst(allProjectPrds.filter((prd) => isActivePrdStatus(prd.status)));

  lines.push(CONTEXT_SECTION_TITLES.prd.overview);
  lines.push(MODE_USAGE.prd);

  const actionablePrd = prds.find((prd) => prd.status === "draft" || prd.status === "ready");
  if (actionablePrd) {
    lines.push(
      `Latest actionable PRD: run \`depot prd show ${actionablePrd.id}\` before editing this chain.`,
    );
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.prd.prds);
  if (prds.length === 0) {
    lines.push("No active PRDs found for this project.");
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

async function renderDevContext(
  db: Database,
  workspaceId: string,
  prdTarget?: string,
): Promise<string> {
  const status = await buildWorkspaceStatus(db, workspaceId);
  const template = getContextTemplate("dev").trim();
  const lines: string[] = [];

  appendHeader(lines, "dev", status.project, status.workspace);

  // ── Explicit PRD targeting ─────────────────────────────────────────────────
  if (prdTarget !== undefined && prdTarget !== "") {
    const resolution = await resolvePrdTarget(db, workspaceId, prdTarget);

    if (resolution.kind === "not_found") {
      throw new Error(
        `No PRD found matching '${prdTarget}' in this workspace.\n` +
          `Provide the full PRD ID or a title substring that uniquely identifies one PRD.\n` +
          `Run \`depot prd list\` to see available PRDs.`,
      );
    }

    if (resolution.kind === "ambiguous") {
      const candidateLines = resolution.candidates
        .map((prd) => `  ${prd.id}  ${prd.title}  [${prd.status}]  rev ${prd.revision}`)
        .join("\n");
      throw new Error(
        `'${prdTarget}' matches multiple PRDs. Provide the full ID to target one:\n${candidateLines}`,
      );
    }

    const targetedPrd = resolution.prd;
    const launchability = await checkPrdLaunchability(db, workspaceId, targetedPrd);

    if (!launchability.launchable) {
      throw new Error(
        `PRD '${targetedPrd.id}' (${targetedPrd.title}) cannot be launched in dev mode.\n${launchability.reason}`,
      );
    }

    const allTasks = await listTasks(db, targetedPrd.id);
    appendDevPrdSections(lines, targetedPrd, allTasks, status.recentActivity, template);
    return lines.join("\n");
  }

  // ── Auto-resolution (no explicit target) ──────────────────────────────────
  if (status.conflictingPrds.length > 0) {
    throw new Error(buildActivePrdConflictMessage("dev", status.workspace, status.conflictingPrds));
  }

  if (!status.activePrd) {
    lines.push(CONTEXT_SECTION_TITLES.dev.activePrd);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.activePrd);
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
    appendRecentActivitySection(lines, status.recentActivity);
    lines.push(CONTEXT_SECTION_TITLES.dev.nextRecommendedTask);
    lines.push(...DEV_PLACEHOLDERS.noActivePrd.nextRecommendedTask);
    lines.push("");
    lines.push(CONTEXT_SECTION_TITLES.dev.instructions);
    lines.push(template);
    return lines.join("\n");
  }

  appendDevPrdSections(lines, status.activePrd, status.allTasks, status.recentActivity, template);
  return lines.join("\n");
}

function appendDevPrdSections(
  lines: string[],
  prd: PrdRow,
  allTasks: TaskRow[],
  recentActivity: Array<{ createdAt: Date; eventType: string; payload: string }>,
  template: string,
): void {
  lines.push(CONTEXT_SECTION_TITLES.dev.activePrd);
  lines.push(`${prd.id}  ${prd.title}  [${prd.status}]  rev ${prd.revision}`);
  if (prd.context) {
    lines.push(`Context : ${prd.context}`);
  }
  if (prd.scope) {
    lines.push(`Scope   : ${prd.scope}`);
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
    lines.push(
      `Started : ${currentTask.startedAt ? formatDate(currentTask.startedAt) : "unknown"}`,
    );
    lines.push(
      `Summary : ${summarizeTaskDescription(currentTask.description, currentTask.descriptionFormat)}`,
    );
    lines.push(`Read full spec: depot task show ${currentTask.id}`);
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

  appendRecentActivitySection(lines, recentActivity);

  lines.push(CONTEXT_SECTION_TITLES.dev.nextRecommendedTask);
  const nextTask = findNextRecommendedTask(allTasks);
  if (!nextTask) {
    lines.push("No task is currently recommendable.");
  } else {
    lines.push(`${nextTask.id}  ${nextTask.title}`);
    lines.push(`Effort      : ${nextTask.effort}`);
    lines.push("Dependencies: satisfied");
    lines.push(
      `Summary     : ${summarizeTaskDescription(nextTask.description, nextTask.descriptionFormat)}`,
    );
    lines.push(`Read full spec: depot task show ${nextTask.id}`);
    lines.push("Criteria:");
    appendCriteria(lines, nextTask.doneCriteria);
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.dev.instructions);
  lines.push(template);
}

async function buildIndexStatus(
  db: Database,
  activeResolution: ActivePrdResolution,
  prds: PrdRow[],
  mode: ContextMode,
): Promise<string> {
  switch (mode) {
    case "prd":
      return buildIndexPrdStatus(prds);
    case "dev":
      return buildIndexDevStatus(db, activeResolution);
    case "coder":
      return "Run: depot context coder <prd-id>";
    case "auditor":
      return "Run: depot context auditor <prd-id>";
  }
}

function buildIndexPrdStatus(prds: PrdRow[]): string {
  const nonTerminal = sortPrdsNewestFirst(prds.filter((prd) => isActivePrdStatus(prd.status)));
  if (nonTerminal.length === 0) {
    return "No active PRDs in this workspace yet.";
  }

  const latest = nonTerminal[0]!;
  return `${nonTerminal.length} active PRD(s). Latest: ${latest.id} [${latest.status}] rev ${latest.revision}.`;
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

/**
 * Resolve a free-text target to a specific PRD within the current workspace.
 * Tries exact ID match first, then unique case-insensitive substring title match.
 */
export async function resolvePrdTarget(
  db: Database,
  workspaceId: string,
  target: string,
): Promise<PrdTargetResolution> {
  const workspace = await getWorkspace(db, workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  const allPrds = await listPrds(db, { projectId: workspace.projectId });

  // Exact ID match — highest confidence
  const byId = allPrds.find((prd) => prd.id === target);
  if (byId) {
    return { kind: "found", prd: byId };
  }

  // Case-insensitive substring title match
  const normalizedTarget = target.toLowerCase();
  const byTitle = allPrds.filter((prd) => prd.title.toLowerCase().includes(normalizedTarget));

  if (byTitle.length === 1) {
    return { kind: "found", prd: byTitle[0]! };
  }

  if (byTitle.length > 1) {
    return { kind: "ambiguous", candidates: byTitle };
  }

  return { kind: "not_found" };
}

/**
 * Verify that a resolved PRD is launchable in dev mode.
 * Checks status compatibility, workspace coherence, and active-PRD conflicts.
 */
export async function checkPrdLaunchability(
  db: Database,
  workspaceId: string,
  prd: PrdRow,
): Promise<PrdLaunchability> {
  // Status must be compatible with the dev execution flow
  if (prd.status !== "ready" && prd.status !== "in_progress") {
    return {
      launchable: false,
      reason: `PRD status is '${prd.status}'. Only 'ready' or 'in_progress' PRDs can be targeted in dev mode.`,
    };
  }

  // Workspace coherence: if the PRD is already assigned to a workspace, it must match
  if (prd.workspaceId !== null && prd.workspaceId !== workspaceId) {
    return {
      launchable: false,
      reason: `PRD '${prd.id}' belongs to a different workspace and cannot be targeted here.`,
    };
  }

  // Conflict check: a committed PRD cannot be targeted if another PRD is already active
  if (prd.status === "ready") {
    const activePrds = (await listPrds(db, { workspaceId })).filter(
      (p) => p.status === "in_progress",
    );
    if (activePrds.length > 0) {
      const conflict = activePrds[0]!;
      return {
        launchable: false,
        reason: `Cannot target ready PRD '${prd.id}': workspace already has an active PRD '${conflict.id}' (${conflict.title}). Complete or cancel the active PRD first.`,
      };
    }
  }

  return { launchable: true };
}

async function renderCoderContext(
  db: Database,
  workspaceId: string,
  prdId?: string,
  reviewId?: string,
): Promise<string> {
  if (!prdId) {
    throw new Error(
      "depot context coder requires a PRD ID.\nUsage: depot context coder <prd-id> [--review <review-id>]",
    );
  }

  const prd = await getPrd(db, prdId);
  if (!prd) throw new Error(`PRD not found: ${prdId}`);

  const header = await loadWorkspaceHeader(db, workspaceId);
  const template = getContextTemplate("coder").trim();
  const lines: string[] = [];

  appendHeader(lines, "coder", header.project, header.workspace);

  lines.push(CONTEXT_SECTION_TITLES.coder.prd);
  lines.push(`${prd.id}  ${prd.title}  [${prd.status}]  rev ${prd.revision}`);
  if (prd.context) lines.push(`Context : ${prd.context}`);
  if (prd.scope) lines.push(`Scope   : ${prd.scope}`);
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.coder.tasks);

  if (reviewId) {
    const review = await getReview(db, reviewId);
    if (!review) throw new Error(`Review not found: ${reviewId}`);
    lines.push(`Review: ${review.id} [${review.type}] [${review.status}]`);
    if (review.userFeedback) lines.push(`User feedback: ${review.userFeedback}`);
    lines.push("");
    const reviewTasks = await listReviewTasks(db, reviewId);
    const pending = reviewTasks.filter((t) => t.status !== "done" && t.status !== "skipped");
    if (pending.length === 0) {
      lines.push("No pending review tasks.");
    } else {
      for (const task of pending) {
        const sev = task.severity ? ` [${task.severity}]` : "";
        lines.push(`${task.id}  ${task.title}${sev}  [${task.status}]`);
        lines.push(`  Criteria: ${task.doneCriteria}`);
      }
    }
  } else {
    const allTasks = await listTasks(db, prdId);
    const pending = allTasks.filter((t) => t.status !== "done" && t.status !== "skipped");
    if (pending.length === 0) {
      lines.push("No pending tasks for this PRD.");
    } else {
      for (const task of pending) {
        lines.push(
          `${task.id}  ${task.title}  [${task.status}]  effort: ${task.effort}  pos: ${task.position}`,
        );
        lines.push(
          `  Summary: ${summarizeTaskDescription(task.description, task.descriptionFormat)}`,
        );
        lines.push(`  Criteria: ${task.doneCriteria}`);
      }
    }
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.coder.instructions);
  lines.push(template);

  return lines.join("\n");
}

async function renderAuditorContext(
  db: Database,
  workspaceId: string,
  prdId?: string,
): Promise<string> {
  if (!prdId) {
    throw new Error(
      "depot context auditor requires a PRD ID.\nUsage: depot context auditor <prd-id>",
    );
  }

  const prd = await getPrd(db, prdId);
  if (!prd) throw new Error(`PRD not found: ${prdId}`);

  const header = await loadWorkspaceHeader(db, workspaceId);
  const template = getContextTemplate("auditor").trim();
  const lines: string[] = [];

  appendHeader(lines, "auditor", header.project, header.workspace);

  lines.push(CONTEXT_SECTION_TITLES.auditor.prd);
  lines.push(`${prd.id}  ${prd.title}  [${prd.status}]  rev ${prd.revision}`);
  if (prd.context) lines.push(`Context : ${prd.context}`);
  if (prd.scope) lines.push(`Scope   : ${prd.scope}`);
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.auditor.doneTasks);
  const allTasks = await listTasks(db, prdId);
  const doneTasks = allTasks.filter((t) => t.status === "done" || t.status === "skipped");
  if (doneTasks.length === 0) {
    lines.push("No completed tasks yet.");
  } else {
    for (const task of doneTasks) {
      lines.push(
        `${task.id}  ${task.title}  [${task.status}]  completed: ${task.completedAt ? formatDate(task.completedAt) : "unknown"}`,
      );
    }
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.auditor.lastReview);
  const allReviews = await listReviews(db, prdId);
  const agentReviews = allReviews.filter((r) => r.type === "agent");
  const lastAgentReview = agentReviews[agentReviews.length - 1];
  if (!lastAgentReview) {
    lines.push("No previous agent review for this PRD.");
  } else {
    lines.push(
      `${lastAgentReview.id}  [${lastAgentReview.status}]  created: ${formatDate(lastAgentReview.createdAt)}`,
    );
    const reviewTasks = await listReviewTasks(db, lastAgentReview.id);
    if (reviewTasks.length > 0) {
      lines.push(`Tasks (${reviewTasks.length}):`);
      for (const task of reviewTasks) {
        const sev = task.severity ? ` [${task.severity}]` : "";
        lines.push(`  ${task.id}  ${task.title}${sev}  [${task.status}]`);
      }
    }
  }
  lines.push("");

  lines.push(CONTEXT_SECTION_TITLES.auditor.instructions);
  lines.push(template);

  return lines.join("\n");
}

function resolveActivePrd(prds: PrdRow[]): ActivePrdResolution {
  const activePrds = sortPrdsNewestFirst(prds.filter((prd) => prd.status === "in_progress"));
  if (activePrds.length === 0) {
    return { kind: "none" };
  }
  if (activePrds.length > 1) {
    return { kind: "conflict", prds: activePrds };
  }
  return { kind: "single", prd: activePrds[0]! };
}

function appendRecentActivitySection(
  lines: string[],
  activity: Array<{ createdAt: Date; eventType: string; payload: string }>,
): void {
  lines.push(CONTEXT_SECTION_TITLES.dev.recentActivity);

  if (activity.length === 0) {
    lines.push("No recent activity for this workspace.");
    lines.push("");
    return;
  }

  lines.push(`Last ${RECENT_ACTIVITY_LIMIT} entries for the current workspace:`);
  for (const entry of activity) {
    if (entry.eventType === "session_start") {
      const payload = JSON.parse(entry.payload) as Record<string, unknown>;
      const label = payload.context ? String(payload.context) : "New session";
      lines.push(`──── ${formatDate(entry.createdAt)}  session: ${label} ────`);
    } else {
      const payload = JSON.parse(entry.payload) as Record<string, unknown>;
      lines.push(
        `${formatDate(entry.createdAt)}  ${entry.eventType}  ${summarizeActivityPayload(entry.eventType, payload)}`,
      );
    }
  }
  lines.push("");
}

function buildProgressSummary(tasks: TaskRow[]): string {
  if (tasks.length === 0) {
    return "No tasks exist for the active PRD yet.";
  }

  let doneCount = 0;
  let inProgressCount = 0;
  let blockedCount = 0;
  let pendingCount = 0;
  let skippedCount = 0;

  for (const task of tasks) {
    switch (task.status) {
      case "done":
        doneCount++;
        break;
      case "in_progress":
        inProgressCount++;
        break;
      case "blocked":
        blockedCount++;
        break;
      case "pending":
        pendingCount++;
        break;
      case "skipped":
        skippedCount++;
        break;
    }
  }

  return `${doneCount}/${tasks.length} done · ${inProgressCount} in progress · ${blockedCount} blocked · ${pendingCount} pending · ${skippedCount} skipped`;
}

function appendCriteria(lines: string[], doneCriteria: string): void {
  for (const line of doneCriteria.split("\n")) {
    lines.push(`  - ${line}`);
  }
}

function sortPrdsNewestFirst<T extends { createdAt: Date }>(prds: T[]): T[] {
  return [...prds].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

function isActivePrdStatus(status: PrdRow["status"]): boolean {
  return status !== "done" && status !== "canceled";
}

function buildActivePrdConflictMessage(
  mode: ContextMode,
  workspace: WorkspaceRow,
  prds: PrdRow[],
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
