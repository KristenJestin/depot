import { Effect } from "effect";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import {
  CrossEntityError,
  PrdNotFoundError,
  TaskNotFoundError,
  WorkspaceNotFoundError,
} from "#/shared/errors";

/**
 * Cross-entity consistency helpers.
 *
 * These guards centralize the invariants we want enforced at every
 * mutation that wires entities together (PRD ↔ workspace, task ↔ PRD,
 * …). Without them, callers can silently create rows where, e.g.,
 * `prd_revisions.workspaceId` points at a workspace from a different
 * project — a state the rest of the system later rejects with confusing
 * errors at unrelated call sites.
 */

export const assertWorkspaceInProject = (workspaceId: string, projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const workspace = yield* dbQuery(() =>
      db.query.workspaces.findFirst({ where: { id: workspaceId } }),
    );
    if (!workspace) {
      return yield* Effect.fail(new WorkspaceNotFoundError({ id: workspaceId }));
    }
    if (workspace.projectId !== projectId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `Workspace '${workspaceId}' belongs to project '${workspace.projectId}', not '${projectId}'`,
        }),
      );
    }
    return workspace;
  });

export const assertPrdInProject = (prdRevisionId: string, projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: prdRevisionId } }),
    );
    if (!rev) {
      return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));
    }
    if (rev.projectId !== projectId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `PRD '${prdRevisionId}' does not belong to project '${projectId}'`,
        }),
      );
    }
    return rev;
  });

export const assertPrdInWorkspace = (prdRevisionId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: prdRevisionId } }),
    );
    if (!rev) {
      return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));
    }
    if (rev.workspaceId !== null && rev.workspaceId !== workspaceId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `PRD '${prdRevisionId}' does not belong to workspace '${workspaceId}'`,
        }),
      );
    }
    return rev;
  });

export const assertTaskInPrd = (taskId: string, prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* dbQuery(() => db.query.tasks.findFirst({ where: { id: taskId } }));
    if (!task) {
      return yield* Effect.fail(new TaskNotFoundError({ id: taskId }));
    }
    if (task.prdRevisionId !== prdRevisionId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `Task '${taskId}' does not belong to PRD '${prdRevisionId}'`,
        }),
      );
    }
    return task;
  });
