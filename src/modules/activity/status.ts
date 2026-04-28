import { Effect } from "effect";
import { Db } from "#/services/database";
import { WorkspaceNotFoundError, ProjectNotFoundError } from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { listPrds } from "#/modules/prds/domain";
import { listTasks } from "#/modules/tasks/domain";
import { listActivity } from "#/modules/activity/domain";
import type { projects, workspaces, prdRevisions, tasks, activityLog } from "#/db/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkspaceRow = typeof workspaces.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type PrdRevisionRow = typeof prdRevisions.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type ActivityRow = typeof activityLog.$inferSelect;

export type WorkspaceStatus = {
  workspace: WorkspaceRow;
  project: ProjectRow;
  generatedAt: string;
  /** Single active (in_progress) PRD revision, or null if zero or multiple. */
  activePrd: PrdRevisionRow | null;
  /** Non-empty when multiple PRD revisions have status in_progress simultaneously. */
  conflictingPrds: PrdRevisionRow[];
  /** Tasks for activePrd ordered by position. Empty when activePrd is null. */
  allTasks: TaskRow[];
  /** Next pending task with all deps satisfied, or null. */
  nextRecommendedTask: TaskRow | null;
  /** Last N activity entries for this workspace, ascending by time. */
  recentActivity: ActivityRow[];
};

export const RECENT_ACTIVITY_LIMIT = 10;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Find the next pending task that has all dependencies satisfied.
 * Tasks must already be ordered by position (ascending).
 */
export function findNextRecommendedTask<
  T extends { id: string; status: string; dependsOn: string },
>(tasks: T[]): T | null {
  const doneIds = new Set(
    tasks.filter((t) => t.status === "done" || t.status === "skipped").map((t) => t.id),
  );
  for (const task of tasks) {
    if (task.status !== "pending") continue;
    const deps: string[] = JSON.parse(task.dependsOn);
    if (deps.every((depId) => doneIds.has(depId))) return task;
  }
  return null;
}

// ── Effect function ───────────────────────────────────────────────────────────

export const buildWorkspaceStatus = (workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const workspace = yield* dbQuery(() =>
      db.query.workspaces.findFirst({ where: { id: workspaceId } }),
    );
    if (!workspace) return yield* Effect.fail(new WorkspaceNotFoundError({ id: workspaceId }));

    const project = yield* dbQuery(() =>
      db.query.projects.findFirst({ where: { id: workspace.projectId } }),
    );
    if (!project) return yield* Effect.fail(new ProjectNotFoundError({ id: workspace.projectId }));

    const generatedAt = new Date().toISOString();

    const allPrds = yield* listPrds({ workspaceId });
    const activePrds = allPrds.filter((p) => p.status === "in_progress");

    const activePrd = activePrds.length === 1 ? activePrds[0]! : null;
    const conflictingPrds = activePrds.length > 1 ? activePrds : [];

    const recentActivity = yield* listActivity({
      projectId: project.id,
      workspaceId,
      limit: RECENT_ACTIVITY_LIMIT,
    });

    const allTasks = activePrd ? yield* listTasks(activePrd.id) : [];
    const nextRecommendedTask = activePrd ? findNextRecommendedTask(allTasks) : null;

    return {
      workspace,
      project,
      generatedAt,
      activePrd,
      conflictingPrds,
      allTasks,
      nextRecommendedTask,
      recentActivity,
    };
  });
