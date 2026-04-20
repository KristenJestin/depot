import type { Database } from "#/db/client";
import { listPrds, listTasks, listActivity } from "#/lib/workflow";
import { shortId } from "#/lib/ids";

/**
 * Build a structured plaintext handoff summary for a given workspace.
 * Output is deterministic, terminal-readable, and safe to paste into agent context.
 * Sections with no relevant data are omitted.
 */
export async function buildHandoff(db: Database, workspaceId: string): Promise<string> {
  // Resolve workspace and project
  const workspace = await db.query.workspaces.findFirst({
    where: { id: workspaceId },
  });
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const project = await db.query.projects.findFirst({
    where: { id: workspace.projectId },
  });
  if (!project) throw new Error(`Project not found: ${workspace.projectId}`);

  const lines: string[] = [];
  const label = workspace.label ?? workspace.path;

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(`=== DEPOT HANDOFF — ${project.name} / ${label} ===`);
  lines.push(new Date().toISOString());
  lines.push("");

  // Find in_progress PRD for this workspace
  const allPrds = await listPrds(db, { workspaceId });
  const activePrd = allPrds.find((p) => p.status === "in_progress");

  if (!activePrd) {
    lines.push("No active PRD for this workspace. Run `depot prd list` to review available PRDs.");
    lines.push("");

    // Show recent activity if available
    const activity = await listActivity(db, {
      projectId: project.id,
      workspaceId,
      limit: 10,
    });
    if (activity.length > 0) {
      appendRecentActivity(lines, activity);
    }

    appendResume(lines);
    return lines.join("\n");
  }

  // ── Active PRD ──────────────────────────────────────────────────────────────
  lines.push("## Active PRD");
  lines.push(`${shortId(activePrd.id)}  ${activePrd.title}  (revision ${activePrd.revision})`);
  if (activePrd.context) {
    const truncated =
      activePrd.context.length > 300
        ? activePrd.context.slice(0, 300) + "\u2026"
        : activePrd.context;
    lines.push(truncated);
  }
  lines.push("");

  // ── Tasks ────────────────────────────────────────────────────────────────────
  const allTasks = await listTasks(db, activePrd.id);

  if (allTasks.length > 0) {
    // ── Task Progress ──────────────────────────────────────────────────────────
    const doneCount = allTasks.filter((t) => t.status === "done").length;
    const inProgressCount = allTasks.filter((t) => t.status === "in_progress").length;
    const blockedCount = allTasks.filter((t) => t.status === "blocked").length;
    const pendingCount = allTasks.filter((t) => t.status === "pending").length;

    lines.push("## Task Progress");
    lines.push(
      `${doneCount}/${allTasks.length} done \u00B7 ${inProgressCount} in progress \u00B7 ${blockedCount} blocked \u00B7 ${pendingCount} pending`,
    );
    lines.push("");

    // ── Current Task ───────────────────────────────────────────────────────────
    const currentTask = allTasks.find((t) => t.status === "in_progress");
    if (currentTask) {
      lines.push("## Current Task");
      lines.push(`${shortId(currentTask.id)}  ${currentTask.title}`);
      lines.push(`Status    : in_progress`);
      if (currentTask.startedAt) {
        lines.push(`Started   : ${currentTask.startedAt}`);
      }
      lines.push(`Criteria  :`);
      for (const line of currentTask.doneCriteria.split("\n")) {
        lines.push(`  - ${line}`);
      }
      lines.push("");
    }

    // ── Blocked Tasks ──────────────────────────────────────────────────────────
    const blockedTasks = allTasks.filter((t) => t.status === "blocked");
    if (blockedTasks.length > 0) {
      lines.push("## Blocked Tasks");
      for (const bt of blockedTasks) {
        lines.push(`${shortId(bt.id)}  ${bt.title}`);
        lines.push(`Reason: ${bt.blockedReason}`);
      }
      lines.push("");
    }
  }

  // ── Recent Activity ──────────────────────────────────────────────────────────
  const activity = await listActivity(db, {
    projectId: project.id,
    workspaceId,
    limit: 10,
  });
  if (activity.length > 0) {
    appendRecentActivity(lines, activity);
  }

  // ── Next Recommended Task ────────────────────────────────────────────────────
  if (allTasks.length > 0) {
    const nextTask = await findNextRecommendedTask(db, allTasks);
    if (nextTask) {
      lines.push("## Next Recommended Task");
      lines.push(`${shortId(nextTask.id)}  ${nextTask.title}`);
      lines.push(`Effort      : ${nextTask.effort}`);
      lines.push(`Dependencies: satisfied`);
      lines.push(`Criteria    :`);
      for (const line of nextTask.doneCriteria.split("\n")) {
        lines.push(`  - ${line}`);
      }
      lines.push("");
    }
  }

  appendResume(lines);
  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function appendRecentActivity(
  lines: string[],
  activity: Array<{
    createdAt: string;
    eventType: string;
    payload: string;
  }>,
): void {
  lines.push(`## Recent Activity  (last 10 entries)`);
  for (const entry of activity) {
    const payload = JSON.parse(entry.payload);
    const summary = summarizePayload(entry.eventType, payload);
    lines.push(`${entry.createdAt}  ${entry.eventType}  ${summary}`);
  }
  lines.push("");
}

function appendResume(lines: string[]): void {
  lines.push("## Resume");
  lines.push("Run `depot playbook dev` for full execution instructions.");
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
