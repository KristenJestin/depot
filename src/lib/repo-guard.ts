import { Effect } from "effect";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { RepoNotRegisteredError, ShaNotFoundError } from "#/shared/errors";
import { Db } from "#/services/database";
import { resolveProjectRepos, type ResolvedRepo } from "#/modules/projects/repos";

const execFileAsync = promisify(execFile);

/**
 * Assert that `repoRootPath` belongs to the project's repo set.
 *
 * For a mono-repo project (no `project_repo` rows) the implicit repo resolved
 * from the workspace path is accepted with no config required. For a
 * multi-repo project the path must match one of the registered repos —
 * otherwise the capture would anchor a foreign SHA, which is exactly the
 * silent-corruption path this guard prevents.
 */
export const assertRepoRegistered = (
  projectId: string,
  repoRootPath: string,
  workspacePath: string,
): Effect.Effect<ResolvedRepo, RepoNotRegisteredError, Db> =>
  Effect.gen(function* () {
    const repos = yield* resolveProjectRepos(projectId, workspacePath).pipe(
      Effect.catchAll(() => Effect.succeed([] as ResolvedRepo[])),
    );
    const normalized = path.resolve(repoRootPath);
    const match = repos.find((repo) => path.resolve(repo.path) === normalized);
    if (match) return match;
    return yield* Effect.fail(
      new RepoNotRegisteredError({
        projectId,
        repoRootPath: normalized,
        knownRepos: repos.map((r) => r.name),
      }),
    );
  });

/**
 * Assert that `sha` resolves to a commit object in the git repo at `repoPath`.
 */
export const assertShaExists = (
  repoPath: string,
  sha: string,
): Effect.Effect<void, ShaNotFoundError> =>
  Effect.tryPromise({
    try: async () => {
      await execFileAsync("git", ["-C", repoPath, "cat-file", "-e", `${sha}^{commit}`]);
    },
    catch: () => new ShaNotFoundError({ repoPath, sha }),
  });
