import { Effect } from "effect";
import path from "node:path";
import { resolveProjectRepos } from "#/modules/projects/repos";
import { hasUncommittedChanges, listWorktrees, type WorktreeEntry } from "#/lib/git";

/**
 * Per-repo ship state injected into the `depot context ship` output.
 *
 * The ship pipeline iterates over the PRD's repos (registered `project_repo`s,
 * or the single implicit mono-repo). For each repo it needs three things up
 * front: the base branch to pull, the linked worktree to remove (if any), and
 * whether the worktree is clean enough to ship.
 */
export type RepoShipState = {
  /** Repo name — `(default)` for the implicit mono-repo. */
  name: string;
  /** Absolute repo path (the main checkout). */
  path: string;
  /** Whether this is the implicit mono-repo (no `project_repo` row). */
  implicit: boolean;
  /** Base branch to switch to and `git pull --ff-only` before marking done. */
  baseBranch: string;
  /**
   * Detected feature worktree for this repo, or `null` when none is linked.
   * Resolution is dynamic (`git worktree list` per repo) so it stays correct
   * even when the worktree was created outside depot.
   */
  worktreePath: string | null;
  /** Branch checked out in the detected worktree, when known. */
  worktreeBranch: string | null;
  /**
   * Whether the detected worktree (or the main checkout when no worktree is
   * linked) has uncommitted changes. A dirty worktree blocks the ship.
   */
  dirty: boolean;
};

/**
 * Pick the feature worktree for a repo. The main checkout is always the first
 * `git worktree list` entry and is never a ship target — only linked worktrees
 * are considered. When `worktreeHint` matches a linked worktree path, that one
 * wins. Otherwise, when the repo has exactly one linked worktree, that is the
 * feature worktree.
 */
export function pickFeatureWorktree(
  entries: WorktreeEntry[],
  worktreeHint: string | null,
): WorktreeEntry | null {
  const linked = entries.slice(1);
  if (linked.length === 0) return null;
  if (worktreeHint) {
    const normalizedHint = path.resolve(worktreeHint);
    const matched = linked.find((entry) => path.resolve(entry.path) === normalizedHint);
    if (matched) return matched;
  }
  return linked.length === 1 ? linked[0]! : null;
}

/**
 * Resolve the per-repo ship state for a PRD. Goes through `resolveProjectRepos`
 * so mono- and multi-repo projects share one code path: a mono-repo project
 * yields a single implicit repo, matching today's behaviour.
 */
export const resolveRepoShipState = (
  projectId: string,
  workspacePath: string,
  worktreeHint: string | null,
) =>
  Effect.gen(function* () {
    const repos = yield* resolveProjectRepos(projectId, workspacePath).pipe(
      Effect.catchAll(() => Effect.succeed([])),
    );
    const states: RepoShipState[] = [];
    for (const repo of repos) {
      const entries = yield* listWorktrees(repo.path);
      const feature = pickFeatureWorktree(entries, worktreeHint);
      const inspectPath = feature ? feature.path : repo.path;
      const dirty = yield* hasUncommittedChanges(inspectPath);
      states.push({
        name: repo.name,
        path: repo.path,
        implicit: repo.implicit,
        baseBranch: repo.baseBranch,
        worktreePath: feature ? feature.path : null,
        worktreeBranch: feature ? feature.branch : null,
        dirty,
      });
    }
    return states;
  });

/** Verdict of the `prd done` ship-readiness gate. */
export type ShipReadiness = {
  /** True when at least one repo is not shipped/cleaned yet. */
  blocked: boolean;
  /** One human-readable reason per offending repo. */
  reasons: string[];
};

/**
 * Decide whether `prd done` should pause for re-confirmation.
 *
 * The reliable, squash-safe signal that a PRD has NOT been shipped is a feature
 * worktree that is still linked: a clean ship removes it (`ship.md` step 3). We
 * deliberately do not test git merge ancestry — a squash merge never makes the
 * feature branch an ancestor of base, so an ancestry check would flag every
 * squash-merged PRD as "unmerged" (the same reason depot dropped SHA tracking).
 *
 * A repo with NO feature worktree (work happens on the base checkout directly)
 * is left alone — the explicit close confirmation is the guard there. Pure
 * function so the decision is unit-tested without spawning git.
 */
export function evaluateShipReadiness(states: RepoShipState[]): ShipReadiness {
  const reasons: string[] = [];
  for (const state of states) {
    if (!state.worktreePath) continue;
    const branch = state.worktreeBranch ?? "detached";
    if (state.dirty) {
      reasons.push(`${state.name}: feature worktree '${branch}' has uncommitted changes`);
    } else {
      reasons.push(
        `${state.name}: feature worktree '${branch}' is still linked — ship cleanup not run (not merged/removed)`,
      );
    }
  }
  return { blocked: reasons.length > 0, reasons };
}

/** Render the per-repo ship state as a terminal-friendly block. */
export function renderRepoShipState(states: RepoShipState[]): string {
  if (states.length === 0) {
    return "Repos   : (none resolved — run from inside the workspace)";
  }
  const lines: string[] = [];
  const multi = states.length > 1 || !states[0]!.implicit;
  lines.push(multi ? "Repos   : multi-repo project" : "Repos   : single implicit repo");
  for (const state of states) {
    lines.push(`  - ${state.name}`);
    lines.push(`      path        : ${state.path}`);
    lines.push(`      base branch : ${state.baseBranch}`);
    lines.push(
      `      worktree    : ${
        state.worktreePath
          ? `${state.worktreePath}${state.worktreeBranch ? ` (${state.worktreeBranch})` : ""}`
          : "(none detected)"
      }`,
    );
    lines.push(
      `      status      : ${state.dirty ? "DIRTY — must be clean before ship" : "clean"}`,
    );
  }
  return lines.join("\n");
}
