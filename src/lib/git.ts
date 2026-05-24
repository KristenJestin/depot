import { Effect } from "effect";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve the **main** git repository root containing `cwd`. Unlike
 * `resolveGitRoot`, this collapses linked worktrees onto their owning repo:
 * for a worktree, the result is the path of the main repo, not the worktree's
 * own checkout. Implemented via `git rev-parse --git-common-dir`, whose parent
 * directory is always the main repo root regardless of whether we're inside
 * the main checkout or a linked worktree.
 *
 * Returns `null` when the directory is not inside a git repo or when `git` is
 * unavailable. Never throws.
 */
export const resolveMainRepoRoot = (cwd: string): Effect.Effect<string | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-common-dir"]);
      const raw = stdout.trim();
      if (raw.length === 0) return null;
      const commonDir = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
      return path.dirname(commonDir);
    },
    catch: () => null,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

/**
 * Resolve the git repository root containing `cwd`. Returns `null` when the
 * directory is not inside a git repo or when `git` is unavailable. Never
 * throws — callers treat repo resolution as best-effort.
 */
export const resolveGitRoot = (cwd: string): Effect.Effect<string | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
      const root = stdout.trim();
      return root.length > 0 ? root : null;
    },
    catch: () => null,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));

/**
 * Check whether `status --porcelain` reports any pending changes in `repoPath`.
 * Returns `false` when the path is not a git repo or git is unavailable.
 */
export const hasUncommittedChanges = (repoPath: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", [
        "-c",
        "core.excludesFile=",
        "-C",
        repoPath,
        "status",
        "--porcelain",
      ]);
      return stdout.trim().length > 0;
    },
    catch: () => false,
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));

/** A linked git worktree entry as reported by `git worktree list --porcelain`. */
export type WorktreeEntry = {
  /** Absolute path of the worktree. */
  path: string;
  /** Short branch name checked out in the worktree, or `null` when detached. */
  branch: string | null;
};

/**
 * List the worktrees of the git repo containing `repoPath`. Returns an empty
 * array when the path is not a git repo or git is unavailable. Never throws —
 * worktree resolution is best-effort enrichment.
 */
export const listWorktrees = (repoPath: string): Effect.Effect<WorktreeEntry[], never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", [
        "-C",
        repoPath,
        "worktree",
        "list",
        "--porcelain",
      ]);
      const entries: WorktreeEntry[] = [];
      let current: { path?: string; branch: string | null } | null = null;
      for (const line of stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current?.path) entries.push({ path: current.path, branch: current.branch });
          current = { path: line.slice("worktree ".length).trim(), branch: null };
        } else if (line.startsWith("branch ") && current) {
          current.branch = line
            .slice("branch ".length)
            .trim()
            .replace(/^refs\/heads\//, "");
        }
      }
      if (current?.path) entries.push({ path: current.path, branch: current.branch });
      return entries;
    },
    catch: () => [] as WorktreeEntry[],
  }).pipe(Effect.catchAll(() => Effect.succeed([] as WorktreeEntry[])));

/**
 * Resolve the worktree of `repoPath` that has `branch` checked out. Returns
 * `null` when no linked worktree matches. The main worktree (first entry) is
 * skipped: the ship pipeline only ever removes the dedicated feature worktree,
 * never the base checkout.
 */
export const resolveWorktreeForBranch = (
  repoPath: string,
  branch: string,
): Effect.Effect<string | null, never> =>
  Effect.gen(function* () {
    const entries = yield* listWorktrees(repoPath);
    const match = entries.slice(1).find((entry) => entry.branch === branch);
    return match ? match.path : null;
  });
