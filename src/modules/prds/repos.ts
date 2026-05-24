import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { prdRepos, type PrdRepoRow } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { CrossEntityError, PrdNotFoundError, ValidationError } from "#/shared/errors";
import { getPrd } from "#/modules/prds/domain";
import { resolveProjectRepos, type ResolvedRepo } from "#/modules/projects/repos";

/**
 * Resolve the canonical `prd_repo` row for `(prdRevisionId, repoId)`.
 *
 * Used to make `addPrdRepo` idempotent and `removePrdRepo` a no-op when the
 * pair is not associated.
 */
const findLink = (prdRevisionId: string, repoId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdRepos.findFirst({ where: { prdRevisionId, repoId } }),
    );
    return row ?? null;
  });

/**
 * Attach a `project_repo` to a PRD revision's repo scope.
 *
 * Validates that the repo belongs to the same project as the PRD before
 * inserting. Idempotent: a second call with the same pair returns the
 * existing row instead of failing on the unique index.
 */
export const addPrdRepo = (prdRevisionId: string, repoId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));

    const repo = yield* dbQuery(() => db.query.projectRepos.findFirst({ where: { id: repoId } }));
    if (!repo) {
      return yield* Effect.fail(new ValidationError({ reason: `Repo not found: ${repoId}` }));
    }
    if (repo.projectId !== rev.projectId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `Repo '${repo.name}' (${repoId}) does not belong to project '${rev.projectId}'`,
        }),
      );
    }

    const existing = yield* findLink(prdRevisionId, repoId);
    if (existing) return existing;

    const rows = yield* dbQuery(() =>
      db.insert(prdRepos).values({ id: generateId(), prdRevisionId, repoId }).returning(),
    );
    return rows[0]!;
  });

/**
 * Detach a `project_repo` from a PRD revision's repo scope.
 *
 * No-op when the pair is not associated; the caller does not need to check
 * existence beforehand.
 */
export const removePrdRepo = (prdRevisionId: string, repoId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(prdRepos)
        .where(and(eq(prdRepos.prdRevisionId, prdRevisionId), eq(prdRepos.repoId, repoId))),
    );
    return undefined;
  });

/** List the `prd_repo` rows for a PRD revision, ordered by creation. */
export const listPrdRepos = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdRepos.findMany({
        where: { prdRevisionId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

/**
 * Assert that `repoId` is in the parent PRD's repo scope.
 *
 * `repoId` of `null` is always accepted (mono-repo, or a change that does not
 * belong to any registered repo). When non-null, the repo must appear in
 * `prd_repo` for the PRD revision — otherwise we refuse with a message that
 * tells the caller exactly what is wrong.
 */
export const assertTaskRepoInPrdScope = (
  prdRevisionId: string,
  repoId: string | null | undefined,
) =>
  Effect.gen(function* () {
    if (repoId === null || repoId === undefined) return;
    const db = yield* Db;
    const link = yield* dbQuery(() =>
      db.query.prdRepos.findFirst({ where: { prdRevisionId, repoId } }),
    );
    if (!link) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Repo '${repoId}' is not in the PRD's repo scope. Add it first with 'depot prd repos add <prdId> <repoName>'.`,
        }),
      );
    }
  });

/**
 * Resolve the repos a PRD revision targets, as `ResolvedRepo[]`.
 *
 * - When the PRD has at least one `prd_repo` entry, returns those repos
 *   resolved from `project_repo`. This is the PRD-scoped view used by
 *   `pre-ship-check` / `pre-review-check` in multi-repo projects (PRD 0007 T3).
 * - When the PRD has no `prd_repo`, falls back to `resolveProjectRepos` for the
 *   project — which itself returns either every registered `project_repo`, or
 *   a single implicit repo derived from the workspace path in mono-repo
 *   projects. The PRD-aware caller stays a one-liner in both cases.
 */
export const resolvePrdRepos = (prdRevisionId: string, projectId: string, workspacePath: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const links = yield* dbQuery(() =>
      db.query.prdRepos.findMany({
        where: { prdRevisionId },
        orderBy: { createdAt: "asc" },
      }),
    );
    if (links.length === 0) {
      return yield* resolveProjectRepos(projectId, workspacePath).pipe(
        Effect.catchAll(() => Effect.succeed([] as ResolvedRepo[])),
      );
    }
    const repos: ResolvedRepo[] = [];
    for (const link of links) {
      const row = yield* dbQuery(() =>
        db.query.projectRepos.findFirst({ where: { id: link.repoId } }),
      );
      if (!row) continue;
      repos.push({
        id: row.id,
        name: row.name,
        path: row.path,
        isPrimary: row.isPrimary,
        baseBranch: row.baseBranch,
        implicit: false,
      });
    }
    return repos;
  });

/** Re-export for external typing convenience. */
export type { PrdRepoRow };
