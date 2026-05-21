import { Effect } from "effect";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Capture the current HEAD SHA in a given path.
 * Returns `null` when the directory is not a git repo (the most common
 * non-error case) or when `git` is unavailable. Never throws — callers
 * treat SHA capture as best-effort enrichment, not as a load-bearing
 * invariant.
 */
export const captureSha = (cwd: string): Effect.Effect<string | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"]);
      const sha = stdout.trim();
      return sha.length > 0 ? sha : null;
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
