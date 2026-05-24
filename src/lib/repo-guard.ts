import { Effect } from "effect";
import path from "node:path";
import { RepoNotRegisteredError } from "#/shared/errors";
import { Db } from "#/services/database";
import { resolveProjectRepos, type ResolvedRepo } from "#/modules/projects/repos";

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
