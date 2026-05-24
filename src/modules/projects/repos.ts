import { Effect } from "effect";
import { eq } from "drizzle-orm";
import path from "node:path";
import { projectRepos, type ProjectRepoRow, type WorkspaceRow } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId, normalizeWorkspacePath } from "#/shared/utils";
import { ValidationError } from "#/shared/errors";
import { resolveGitRoot, resolveMainRepoRoot } from "#/lib/git";
import { getConfig } from "#/modules/projects/config";

/**
 * A resolved repo for a project. Either a real `project_repo` row or the
 * implicit single repo derived from the workspace path when the project has
 * no registered repos. `resolveProjectRepos` is the one function every other
 * consumer (directive runs, guards, repo-aware context) goes through so they
 * never have to branch on mono- vs multi-repo.
 */
export type ResolvedRepo = {
  id: string | null;
  name: string;
  path: string;
  isPrimary: boolean;
  baseBranch: string;
  implicit: boolean;
};

const IMPLICIT_REPO_NAME = "(default)";

const resolveRegisteredRepoPath = (repoPath: string, workspacePath: string): string =>
  path.isAbsolute(repoPath) ? path.resolve(repoPath) : path.resolve(workspacePath, repoPath);

const normalizedPathKey = (p: string): string => normalizeWorkspacePath(path.resolve(p));

const toResolved = (row: ProjectRepoRow, workspacePath: string): ResolvedRepo => ({
  id: row.id,
  name: row.name,
  path: resolveRegisteredRepoPath(row.path, workspacePath),
  isPrimary: row.isPrimary,
  baseBranch: row.baseBranch,
  implicit: false,
});

export const addRepo = (input: {
  projectId: string;
  name: string;
  path: string;
  isPrimary?: boolean;
  baseBranch?: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.projectRepos.findFirst({
        where: { projectId: input.projectId, name: input.name },
      }),
    );
    if (existing) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `A repo named '${input.name}' is already registered for this project.`,
        }),
      );
    }
    const rows = yield* dbQuery(() =>
      db
        .insert(projectRepos)
        .values({
          id: generateId(),
          projectId: input.projectId,
          name: input.name,
          path: input.path,
          isPrimary: input.isPrimary ?? false,
          baseBranch: input.baseBranch ?? "main",
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listRepos = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.projectRepos.findMany({
        where: { projectId },
        orderBy: { name: "asc" },
      }),
    );
  });

export const getRepo = (projectId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.projectRepos.findFirst({ where: { projectId, name } }),
    );
    return row ?? null;
  });

export const removeRepo = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() => db.delete(projectRepos).where(eq(projectRepos.id, id)));
    return id;
  });

export const updateRepo = (
  id: string,
  patch: { baseBranch?: string; isPrimary?: boolean; path?: string },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() => db.query.projectRepos.findFirst({ where: { id } }));
    if (!existing) {
      return yield* Effect.fail(new ValidationError({ reason: `Repo not found: ${id}` }));
    }
    const rows = yield* dbQuery(() =>
      db
        .update(projectRepos)
        .set({
          baseBranch: patch.baseBranch ?? existing.baseBranch,
          isPrimary: patch.isPrimary ?? existing.isPrimary,
          path: patch.path ?? existing.path,
        })
        .where(eq(projectRepos.id, id))
        .returning(),
    );
    return rows[0]!;
  });

/**
 * Resolve the `project_repo` row that `cwd` belongs to, relative to a
 * registered workspace. Returns `null` for any legitimate case where no
 * specific sub-repo applies: mono-repo project (no `project_repo` registered),
 * cwd at the shell root of a multi-repo project (outside every registered
 * sub-repo), or non-git workspace.
 *
 * The matching path is the **main** repo root resolved via
 * `git rev-parse --git-common-dir`, so a linked worktree of a sub-repo is
 * recognised as that sub-repo even when the worktree directory itself lives
 * elsewhere on disk. The longest-prefix match wins, so nested repos resolve to
 * the innermost registered one.
 */
export const resolveCurrentRepo = (ws: WorkspaceRow, cwd: string) =>
  Effect.gen(function* () {
    const repos = yield* listRepos(ws.projectId);
    if (repos.length === 0) return null;
    const repoRoot = yield* resolveMainRepoRoot(cwd);
    if (!repoRoot) return null;
    const normalizedRoot = normalizedPathKey(repoRoot);
    const wsPath = path.resolve(ws.path);

    let best: ProjectRepoRow | null = null;
    let bestLen = -1;
    for (const repo of repos) {
      const repoAbs = path.isAbsolute(repo.path) ? repo.path : path.resolve(wsPath, repo.path);
      const normalizedRepoAbs = normalizedPathKey(repoAbs);
      if (
        normalizedRoot === normalizedRepoAbs ||
        normalizedRoot.startsWith(normalizedRepoAbs + "/")
      ) {
        if (normalizedRepoAbs.length > bestLen) {
          best = repo;
          bestLen = normalizedRepoAbs.length;
        }
      }
    }
    return best;
  });

/**
 * Resolve the registered `project_repo` whose root matches the git repo
 * containing `cwdOrPath`. Returns `null` when the path is not inside a git
 * repo or when no registered repo matches the resolved root.
 */
export const resolveRepoFromPath = (projectId: string, cwdOrPath: string) =>
  Effect.gen(function* () {
    const repos = yield* listRepos(projectId);
    if (repos.length === 0) return null;
    const gitRoot = yield* resolveGitRoot(cwdOrPath);
    if (!gitRoot) return null;
    const normalizedRoot = normalizedPathKey(gitRoot);
    const match = repos.find((repo) => normalizedPathKey(repo.path) === normalizedRoot);
    return match ?? null;
  });

/**
 * The central fallback function. When the project has registered repos, it
 * returns them. When it has none, it returns a single implicit repo whose
 * path is the git root resolved from `workspacePath` (falling back to the
 * workspace path itself when it is not a git repo). The implicit repo's base
 * branch comes from `project_config['baseBranch']`, defaulting to `main`.
 */
export const resolveProjectRepos = (projectId: string, workspacePath: string) =>
  Effect.gen(function* () {
    const repos = yield* listRepos(projectId);
    if (repos.length > 0) {
      return repos.map((repo) => toResolved(repo, workspacePath));
    }
    const gitRoot = yield* resolveGitRoot(workspacePath);
    const baseBranchConfig = yield* getConfig(projectId, "baseBranch");
    const implicit: ResolvedRepo = {
      id: null,
      name: IMPLICIT_REPO_NAME,
      path: path.resolve(gitRoot ?? workspacePath),
      isPrimary: true,
      baseBranch: baseBranchConfig?.value ?? "main",
      implicit: true,
    };
    return [implicit];
  });
