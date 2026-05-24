import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { workspaces, prdRevisions, tasks, activityLog } from "#/db/schema";
import { generateId, normalizeWorkspacePath } from "#/shared/utils";
import { Db } from "#/services/database";
import { WorkspaceNotFoundError, WorkspaceHasLinkedPrdsError } from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import fs from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Check whether the workspace's path still exists on disk.
 * Synchronous and swallowing: any fs error (ENOENT, ENOTDIR, EACCES, …)
 * returns `false` rather than throwing — the resolution path never breaks
 * because a workspace points into the void.
 */
export function workspaceExistsOnDisk(ws: { path: string }): boolean {
  try {
    statSync(ws.path);
    return true;
  } catch {
    return false;
  }
}

function canonicalizeWorkspacePathForStorage(input: string): string {
  try {
    return realpathSync.native(input);
  } catch {
    return normalizeWorkspacePath(input);
  }
}

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
    const canonicalPath = canonicalizeWorkspacePathForStorage(input.path);
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
 * Resolve the current workspace from a cwd.
 *
 * Resolution order — designed so a too-broad ancestor workspace (e.g. one
 * registered at `~`) cannot shadow a worktree that belongs to another
 * registered project:
 *
 *   1. Exact match (cwd == workspace.path) — always wins.
 *   2. Git worktree fallback (`resolveWorktreeMainPath` → match against
 *      registered workspaces) — preferred over a mere ancestor match.
 *   3. Longest-prefix ancestor match — last resort.
 *   4. Otherwise `null`.
 *
 * Orphan workspaces (path deleted on disk) are masked: the row stays in
 * the DB but never wins a match.
 */
export const resolveWorkspace = (currentPath: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const allWorkspaces = yield* dbQuery(() => db.query.workspaces.findMany());
    const canonicalCurrentPath = normalizeWorkspacePath(currentPath);

    const liveWorkspaces = allWorkspaces.filter((ws) => workspaceExistsOnDisk(ws));

    const findExactMatch = (candidatePath: string) =>
      liveWorkspaces.find((ws) => normalizeWorkspacePath(ws.path) === candidatePath) ?? null;

    const findLongestAncestor = (candidatePath: string) => {
      let bestMatch: (typeof liveWorkspaces)[number] | null = null;
      let bestLen = 0;
      for (const ws of liveWorkspaces) {
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

    const exactMatch = findExactMatch(canonicalCurrentPath);
    if (exactMatch) return exactMatch;

    const mainRepoPath = yield* resolveWorktreeMainPath(currentPath);
    if (mainRepoPath) {
      const worktreeMatch = findLongestAncestor(normalizeWorkspacePath(mainRepoPath));
      if (worktreeMatch) return worktreeMatch;
    }

    return findLongestAncestor(canonicalCurrentPath);
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

    const linkedPrds = yield* dbQuery(() =>
      db.query.prdRevisions.findMany({ where: { workspaceId: id } }),
    );
    if (linkedPrds.length > 0 && !force) {
      return yield* Effect.fail(
        new WorkspaceHasLinkedPrdsError({ workspaceId: id, count: linkedPrds.length }),
      );
    }

    if (force && linkedPrds.length > 0) {
      for (const prd of linkedPrds) {
        const prdTasks = yield* dbQuery(() =>
          db.query.tasks.findMany({ where: { prdRevisionId: prd.id } }),
        );
        for (const task of prdTasks) {
          yield* dbQuery(() => db.delete(activityLog).where(eq(activityLog.taskId, task.id)));
        }
        yield* dbQuery(() => db.delete(activityLog).where(eq(activityLog.prdRevisionId, prd.id)));
        yield* dbQuery(() => db.delete(tasks).where(eq(tasks.prdRevisionId, prd.id)));
      }
      for (const prd of linkedPrds) {
        yield* dbQuery(() => db.delete(prdRevisions).where(eq(prdRevisions.id, prd.id)));
      }
    }

    yield* dbQuery(() => db.delete(activityLog).where(eq(activityLog.workspaceId, id)));
    yield* dbQuery(() => db.delete(workspaces).where(eq(workspaces.id, id)));
  });
