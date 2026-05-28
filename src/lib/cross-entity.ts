import { Effect } from "effect";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import {
  CrossEntityError,
  PrdNotFoundError,
  TaskNotFoundError,
  WorkspaceNotFoundError,
} from "#/shared/errors";

// ── Label helpers ────────────────────────────────────────────────────────────
//
// These small async helpers fetch the human-friendly attributes (label, path,
// title, name) of an entity and format them into the body of a cross-entity
// error message. Without them, every CrossEntityError reads like
// `does not belong to workspace '01KSMTKGKVD5VDWBV9SGV5KJ5J'` — fine for
// machines, opaque for agents and humans.

const projectLabel = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.projects.findFirst({ where: { id }, columns: { name: true } }),
    );
    return row ? `'${row.name}' (${id})` : `'${id}'`;
  });

const workspaceLabel = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.workspaces.findFirst({
        where: { id },
        columns: { label: true, path: true },
      }),
    );
    if (!row) return `'${id}'`;
    return `'${row.label ?? "(unlabeled)"}' at ${row.path} (${id})`;
  });

const prdLabel = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id }, columns: { title: true } }),
    );
    return row ? `'${row.title}' (revision ${id})` : `'${id}'`;
  });

/**
 * Format a `PRD does not belong to workspace` error message with the labels
 * and paths of the workspaces involved, and the title of the PRD. When the
 * PRD is activated on another workspace, that workspace is also included so
 * the caller knows where they should be running the command from.
 */
export const formatPrdWorkspaceMismatch = (
  prdRevisionId: string,
  expectedWorkspaceId: string,
  actualWorkspaceId: string | null,
) =>
  Effect.gen(function* () {
    const prdStr = yield* prdLabel(prdRevisionId);
    const expectedStr = yield* workspaceLabel(expectedWorkspaceId);
    if (actualWorkspaceId === null) {
      return `PRD ${prdStr} does not belong to workspace ${expectedStr}: it is not yet activated on any workspace.`;
    }
    const actualStr = yield* workspaceLabel(actualWorkspaceId);
    return `PRD ${prdStr} does not belong to workspace ${expectedStr}: it is activated on workspace ${actualStr}. Either cd to that workspace, or re-activate the PRD where you intend to work.`;
  });

/**
 * Format a `PRD does not belong to project` mismatch with the project names
 * and the PRD title.
 */
export const formatPrdProjectMismatch = (prdRevisionId: string, expectedProjectId: string) =>
  Effect.gen(function* () {
    const prdStr = yield* prdLabel(prdRevisionId);
    const expectedStr = yield* projectLabel(expectedProjectId);
    return `PRD ${prdStr} does not belong to project ${expectedStr}.`;
  });

/**
 * Format a `Task does not belong to workspace` mismatch with the workspace
 * paths and the task id (no title fetch — tasks are usually short-lived and
 * id is enough context).
 */
export const formatTaskWorkspaceMismatch = (taskId: string, expectedWorkspaceId: string) =>
  Effect.gen(function* () {
    const wsStr = yield* workspaceLabel(expectedWorkspaceId);
    return `Task '${taskId}' does not belong to workspace ${wsStr}.`;
  });

/**
 * Format a `Task does not belong to project` mismatch with the project name.
 */
export const formatTaskProjectMismatch = (taskId: string, expectedProjectId: string) =>
  Effect.gen(function* () {
    const projStr = yield* projectLabel(expectedProjectId);
    return `Task '${taskId}' does not belong to project ${projStr}.`;
  });

/**
 * Format a `Workspace belongs to a different project` mismatch with both
 * project names.
 */
export const formatWorkspaceProjectMismatch = (
  workspaceId: string,
  actualProjectId: string,
  expectedProjectId: string,
) =>
  Effect.gen(function* () {
    const wsStr = yield* workspaceLabel(workspaceId);
    const actualStr = yield* projectLabel(actualProjectId);
    const expectedStr = yield* projectLabel(expectedProjectId);
    return `Workspace ${wsStr} belongs to project ${actualStr}, not ${expectedStr}.`;
  });

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
      const reason = yield* formatWorkspaceProjectMismatch(
        workspaceId,
        workspace.projectId,
        projectId,
      );
      return yield* Effect.fail(new CrossEntityError({ reason }));
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
      const reason = yield* formatPrdProjectMismatch(prdRevisionId, projectId);
      return yield* Effect.fail(new CrossEntityError({ reason }));
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
      const reason = yield* formatPrdWorkspaceMismatch(prdRevisionId, workspaceId, rev.workspaceId);
      return yield* Effect.fail(new CrossEntityError({ reason }));
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
