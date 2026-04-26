import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { workspaces, prds, tasks, activityLog } from "#/db/schema";
import { generateId, normalizeWorkspacePath } from "#/shared/utils";
import { Db } from "#/services/database";
import { WorkspaceNotFoundError, WorkspaceHasLinkedPrdsError } from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import fs from "node:fs/promises";
import path from "node:path";

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Walk up from `startDir` looking for a `.git` file (not directory).
 * If found and it points to a worktree gitdir (contains `/.git/worktrees/`),
 * returns the main repo root path. Otherwise returns null.
 */
export function resolveWorktreeMainPath(startDir: string): Effect.Effect<string | null> {
  const loop = (current: string): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      const gitPath = path.join(current, ".git");
      const stat = yield* Effect.tryPromise(() => fs.stat(gitPath)).pipe(Effect.option);
      if (stat._tag === "Some" && stat.value.isFile()) {
        const content = yield* Effect.tryPromise(() => fs.readFile(gitPath, "utf-8")).pipe(
          Effect.map((c) => c.trim()),
          Effect.orElseSucceed(() => null),
        );
        if (!content) return null;
        const match = /^gitdir:\s*(.+)$/.exec(content);
        if (!match) return null;
        const rawGitdir = match[1]!.trim();
        const gitdir = path.isAbsolute(rawGitdir) ? rawGitdir : path.resolve(current, rawGitdir);
        const normalizedGitdir = gitdir.replace(/\\/g, "/");
        if (!normalizedGitdir.includes("/.git/worktrees/")) return null;
        const gitSegmentIndex = normalizedGitdir.indexOf("/.git/worktrees/");
        return normalizedGitdir.slice(0, gitSegmentIndex);
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      return yield* loop(parent);
    });
  return loop(startDir);
}

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
 * If no match is found and the current path is inside a git worktree,
 * falls back to matching against the main repo path.
 */
export const resolveWorkspace = (currentPath: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const allWorkspaces = yield* dbQuery(() => db.query.workspaces.findMany());
    const canonicalCurrentPath = normalizeWorkspacePath(currentPath);

    const findBestMatch = (candidatePath: string) => {
      let bestMatch: (typeof allWorkspaces)[number] | null = null;
      let bestLen = 0;
      for (const ws of allWorkspaces) {
        const wsPath = normalizeWorkspacePath(ws.path);
        if (candidatePath === wsPath || candidatePath.startsWith(wsPath + "/")) {
          if (wsPath.length > bestLen) {
            bestLen = wsPath.length;
            bestMatch = ws;
          }
        }
      }
      return bestMatch;
    };

    const directMatch = findBestMatch(canonicalCurrentPath);
    if (directMatch) return directMatch;

    const mainRepoPath = yield* resolveWorktreeMainPath(currentPath);
    if (!mainRepoPath) return null;

    return findBestMatch(normalizeWorkspacePath(mainRepoPath));
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
