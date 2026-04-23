import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { workspaces, prds, tasks, activityLog } from "#/db/schema";
import { generateId, normalizeWorkspacePath } from "#/shared/utils";
import { Db } from "#/services/database";
import { WorkspaceNotFoundError, WorkspaceHasLinkedPrdsError } from "#/shared/errors";
import { dbQuery } from "#/shared/db";

// ── Functions ─────────────────────────────────────────────────────────────────

export const addWorkspace = (input: { projectId: string; path: string; label?: string }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const id = generateId();
    const canonicalPath = normalizeWorkspacePath(input.path);
    const rows = yield* dbQuery(() =>
      db
        .insert(workspaces)
        .values({
          id,
          projectId: input.projectId,
          path: canonicalPath,
          label: input.label ?? null,
        })
        .returning(),
    );
    return rows[0]!;
  });

/**
 * Resolve the current workspace using longest-prefix matching on canonical paths.
 * Commands run from any nested subdirectory resolve to the correct workspace.
 */
export const resolveWorkspace = (currentPath: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const allWorkspaces = yield* dbQuery(() => db.query.workspaces.findMany());
    const canonicalCurrentPath = normalizeWorkspacePath(currentPath);

    let bestMatch: (typeof allWorkspaces)[number] | null = null;
    let bestLen = 0;

    for (const ws of allWorkspaces) {
      const wsPath = normalizeWorkspacePath(ws.path);
      if (canonicalCurrentPath === wsPath || canonicalCurrentPath.startsWith(wsPath + "/")) {
        if (wsPath.length > bestLen) {
          bestLen = wsPath.length;
          bestMatch = ws;
        }
      }
    }

    return bestMatch;
  });

export const listWorkspaces = (filter: { projectId?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    if (filter.projectId) {
      return yield* dbQuery(() =>
        db.query.workspaces.findMany({
          where: { projectId: filter.projectId },
          orderBy: { createdAt: "asc" },
        }),
      );
    }
    return yield* dbQuery(() => db.query.workspaces.findMany({ orderBy: { createdAt: "asc" } }));
  });

export const getWorkspace = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.workspaces.findFirst({ where: { id } }));
    return row ?? null;
  });

export const updateWorkspaceLabel = (id: string, label: string | null) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const workspace = yield* getWorkspace(id);
    if (!workspace) return yield* Effect.fail(new WorkspaceNotFoundError({ id }));
    const rows = yield* dbQuery(() =>
      db.update(workspaces).set({ label }).where(eq(workspaces.id, id)).returning(),
    );
    return rows[0]!;
  });

export const removeWorkspace = (id: string, force = false) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const workspace = yield* getWorkspace(id);
    if (!workspace) return yield* Effect.fail(new WorkspaceNotFoundError({ id }));

    const linkedPrds = yield* dbQuery(() => db.query.prds.findMany({ where: { workspaceId: id } }));
    if (linkedPrds.length > 0 && !force) {
      return yield* Effect.fail(
        new WorkspaceHasLinkedPrdsError({ workspaceId: id, count: linkedPrds.length }),
      );
    }

    if (force && linkedPrds.length > 0) {
      for (const prd of linkedPrds) {
        const prdTasks = yield* dbQuery(() =>
          db.query.tasks.findMany({ where: { prdId: prd.id } }),
        );
        for (const task of prdTasks) {
          yield* dbQuery(() => db.delete(activityLog).where(eq(activityLog.taskId, task.id)));
        }
        yield* dbQuery(() => db.delete(activityLog).where(eq(activityLog.prdId, prd.id)));
        yield* dbQuery(() => db.delete(tasks).where(eq(tasks.prdId, prd.id)));
      }
      for (const prd of linkedPrds) {
        yield* dbQuery(() => db.delete(prds).where(eq(prds.id, prd.id)));
      }
    }

    yield* dbQuery(() => db.delete(activityLog).where(eq(activityLog.workspaceId, id)));
    yield* dbQuery(() => db.delete(workspaces).where(eq(workspaces.id, id)));
  });
