import type { Database } from "#/db/client";
import { listPrds, listTasks, listActivity } from "#/lib/workflow";

// ── Structured handoff data ───────────────────────────────────────────────────

export type HandoffTaskSummary = {
  id: string;
  title: string;
  effort: string;
  doneCriteria: string[];
  startedAt: string | null;
  blockedReason: string | null;
};

export type HandoffActivityEntry = {
  createdAt: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export type HandoffData = {
  project: { id: string; name: string };
  workspace: { id: string; path: string; label: string | null };
  generatedAt: string;
  activePrd: {
    id: string;
    title: string;
    revision: number;
    context: string | null;
  } | null;
  taskProgress: {
    total: number;
    done: number;
    inProgress: number;
    blocked: number;
    pending: number;
  } | null;
  currentTask: HandoffTaskSummary | null;
  blockedTasks: Array<{ id: string; title: string; blockedReason: string | null }>;
  nextRecommendedTask: HandoffTaskSummary | null;
  recentActivity: HandoffActivityEntry[];
};

/**
 * Build a structured data object for the handoff of a given workspace.
 * Used by both the text renderer and the JSON output path.
 */
export async function buildHandoffData(db: Database, workspaceId: string): Promise<HandoffData> {
  const workspace = await db.query.workspaces.findFirst({
    where: { id: workspaceId },
  });
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const project = await db.query.projects.findFirst({
    where: { id: workspace.projectId },
  });
  if (!project) throw new Error(`Project not found: ${workspace.projectId}`);

  const generatedAt = new Date().toISOString();

  const allPrds = await listPrds(db, { workspaceId });
  const activePrd = allPrds.find((p) => p.status === "in_progress") ?? null;

  const rawActivity = await listActivity(db, {
    projectId: project.id,
    workspaceId,
    limit: 10,
  });
  const recentActivity: HandoffActivityEntry[] = rawActivity.map((e) => ({
    createdAt: e.createdAt,
    eventType: e.eventType,
    payload: JSON.parse(e.payload) as Record<string, unknown>,
  }));

  if (!activePrd) {
    return {
      project: { id: project.id, name: project.name },
      workspace: { id: workspace.id, path: workspace.path, label: workspace.label },
      generatedAt,
      activePrd: null,
      taskProgress: null,
      currentTask: null,
      blockedTasks: [],
      nextRecommendedTask: null,
      recentActivity,
    };
  }

  const allTasks = await listTasks(db, activePrd.id);

  const done = allTasks.filter((t) => t.status === "done").length;
  const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
  const blocked = allTasks.filter((t) => t.status === "blocked").length;
  const pending = allTasks.filter((t) => t.status === "pending").length;

  const currentTaskRaw = allTasks.find((t) => t.status === "in_progress") ?? null;
  const currentTask: HandoffTaskSummary | null = currentTaskRaw
    ? {
        id: currentTaskRaw.id,
        title: currentTaskRaw.title,
        effort: currentTaskRaw.effort,
        doneCriteria: currentTaskRaw.doneCriteria
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
        startedAt: currentTaskRaw.startedAt,
        blockedReason: currentTaskRaw.blockedReason,
      }
    : null;

  const blockedTasks = allTasks
    .filter((t) => t.status === "blocked")
    .map((t) => ({ id: t.id, title: t.title, blockedReason: t.blockedReason }));

  const nextTaskRaw = await findNextRecommendedTask(db, allTasks);
  const nextRecommendedTask: HandoffTaskSummary | null = nextTaskRaw
    ? {
        id: nextTaskRaw.id,
        title: nextTaskRaw.title,
        effort: nextTaskRaw.effort,
        doneCriteria: nextTaskRaw.doneCriteria
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0),
        startedAt: nextTaskRaw.startedAt,
        blockedReason: nextTaskRaw.blockedReason,
      }
    : null;

  return {
    project: { id: project.id, name: project.name },
    workspace: { id: workspace.id, path: workspace.path, label: workspace.label },
    generatedAt,
    activePrd: {
      id: activePrd.id,
      title: activePrd.title,
      revision: activePrd.revision,
      context: activePrd.context,
    },
    taskProgress: { total: allTasks.length, done, inProgress, blocked, pending },
    currentTask,
    blockedTasks,
    nextRecommendedTask,
    recentActivity,
  };
}

/**
 * Build a structured plaintext handoff summary for a given workspace.
 * Output is deterministic, terminal-readable, and safe to paste into agent context.
 * Sections with no relevant data are omitted.
 */
export async function buildHandoff(db: Database, workspaceId: string): Promise<string> {
  const data = await buildHandoffData(db, workspaceId);
  const lines: string[] = [];
  const label = data.workspace.label ?? data.workspace.path;

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(`=== DEPOT HANDOFF — ${data.project.name} / ${label} ===`);
  lines.push(data.generatedAt);
  lines.push("");

  if (!data.activePrd) {
    lines.push("No active PRD for this workspace. Run `depot prd list` to review available PRDs.");
    lines.push("");

    if (data.recentActivity.length > 0) {
      appendRecentActivity(lines, data.recentActivity);
    }

    appendResume(lines);
    return lines.join("\n");
  }

  // ── Active PRD ──────────────────────────────────────────────────────────────
  lines.push("## Active PRD");
  lines.push(`${data.activePrd.id}  ${data.activePrd.title}  (revision ${data.activePrd.revision})`);
  if (data.activePrd.context) {
    const truncated =
      data.activePrd.context.length > 300
        ? data.activePrd.context.slice(0, 300) + "\u2026"
        : data.activePrd.context;
    lines.push(truncated);
  }
  lines.push("");

  // ── Tasks ────────────────────────────────────────────────────────────────────
  if (data.taskProgress) {
    const { total, done, inProgress, blocked, pending } = data.taskProgress;

    lines.push("## Task Progress");
    lines.push(
      `${done}/${total} done \u00B7 ${inProgress} in progress \u00B7 ${blocked} blocked \u00B7 ${pending} pending`,
    );
    lines.push("");

    if (data.currentTask) {
      lines.push("## Current Task");
      lines.push(`${data.currentTask.id}  ${data.currentTask.title}`);
      lines.push(`Status    : in_progress`);
      if (data.currentTask.startedAt) {
        lines.push(`Started   : ${data.currentTask.startedAt}`);
      }
      lines.push(`Criteria  :`);
      for (const line of data.currentTask.doneCriteria) {
        lines.push(`  - ${line}`);
      }
      lines.push("");
    }

    if (data.blockedTasks.length > 0) {
      lines.push("## Blocked Tasks");
      for (const bt of data.blockedTasks) {
        lines.push(`${bt.id}  ${bt.title}`);
        lines.push(`Reason: ${bt.blockedReason}`);
      }
      lines.push("");
    }
  }

  // ── Recent Activity ──────────────────────────────────────────────────────────
  if (data.recentActivity.length > 0) {
    appendRecentActivity(lines, data.recentActivity);
  }

  // ── Next Recommended Task ────────────────────────────────────────────────────
  if (data.nextRecommendedTask) {
    lines.push("## Next Recommended Task");
    lines.push(`${data.nextRecommendedTask.id}  ${data.nextRecommendedTask.title}`);
    lines.push(`Effort      : ${data.nextRecommendedTask.effort}`);
    lines.push(`Dependencies: satisfied`);
    lines.push(`Criteria    :`);
    for (const line of data.nextRecommendedTask.doneCriteria) {
      lines.push(`  - ${line}`);
    }
    lines.push("");
  }

  appendResume(lines);
  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function appendRecentActivity(lines: string[], activity: HandoffActivityEntry[]): void {
  lines.push(`## Recent Activity  (last 10 entries)`);
  for (const entry of activity) {
    const summary = summarizePayload(entry.eventType, entry.payload);
    lines.push(`${entry.createdAt}  ${entry.eventType}  ${summary}`);
  }
  lines.push("");
}

function appendResume(lines: string[]): void {
  lines.push("## Resume");
  lines.push("Run `depot context dev` for full execution instructions.");
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
      return `${payload.title ?? ""} — ${payload.reason ?? ""}`;
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

/**
 * Find the next pending task that has all dependencies satisfied.
 * Tasks are checked in position order.
 */
async function findNextRecommendedTask(
  db: Database,
  allTasks: Array<{
    id: string;
    status: string;
    dependsOn: string;
    position: number;
    title: string;
    effort: string;
    doneCriteria: string;
    startedAt: string | null;
    blockedReason: string | null;
  }>,
) {
  const doneIds = new Set(allTasks.filter((t) => t.status === "done").map((t) => t.id));

  for (const task of allTasks) {
    if (task.status !== "pending") continue;

    const deps: string[] = JSON.parse(task.dependsOn);
    const allDepsSatisfied = deps.every((depId) => doneIds.has(depId));
    if (allDepsSatisfied) {
      return task;
    }
  }
  return null;
}
