import { Effect } from "effect";
import { and, asc, eq } from "drizzle-orm";
import { prdTags, prds, prdRevisions } from "#/db/schema";
import type { PrdRevisionRow, PrdTagRow } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { PrdNotFoundError, ValidationError } from "#/shared/errors";
import { invalidTagReason } from "#/shared/validator";

/**
 * Tag domain for PRDs (PRD 0019 / T1).
 *
 * Tags live on the *logical* PRD (`prds.id`) rather than on a specific
 * revision, so the grouping is stable across forks. The 5 helpers here are
 * deliberately small: validation lives in `isValidTag` and the domain is a
 * thin wrapper over a single composite-PK table.
 *
 * The CLI surface accepts a "PRD ID" that is actually a revision ID (see
 * `depot prd show`). Each helper accepts that revision ID, looks up the
 * logical PRD, and operates on it. A non-existent revision raises
 * `PrdNotFoundError` so the CLI can surface a clear `not_found` error.
 */

const resolvePrdIdFromRevision = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({
        where: { id: prdRevisionId },
        columns: { prdId: true },
      }),
    );
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));
    return rev.prdId;
  });

const validateTag = (tag: string) =>
  Effect.gen(function* () {
    const reason = invalidTagReason(tag);
    if (reason !== null) {
      return yield* Effect.fail(new ValidationError({ reason }));
    }
  });

/**
 * Attach a tag to a PRD. Idempotent: inserting `(prdId, tag)` twice returns
 * the existing row instead of failing on the composite primary key. The
 * `prdRevisionId` is resolved to the logical PRD ID so a tag added against
 * one revision is visible from every revision of the same PRD.
 */
export const addTag = (prdRevisionId: string, tag: string) =>
  Effect.gen(function* () {
    yield* validateTag(tag);
    const db = yield* Db;
    const prdId = yield* resolvePrdIdFromRevision(prdRevisionId);

    const existing = yield* dbQuery(() => db.query.prdTags.findFirst({ where: { prdId, tag } }));
    if (existing) return existing;

    const rows = yield* dbQuery(() => db.insert(prdTags).values({ prdId, tag }).returning());
    return rows[0]!;
  });

/**
 * Remove a tag from a PRD. No-op when the tag is not attached, so callers
 * never need to check existence beforehand. Returns the logical PRD ID the
 * tag would have been removed from (useful for activity-log attribution
 * even when the row was absent).
 */
export const removeTag = (prdRevisionId: string, tag: string) =>
  Effect.gen(function* () {
    yield* validateTag(tag);
    const db = yield* Db;
    const prdId = yield* resolvePrdIdFromRevision(prdRevisionId);
    yield* dbQuery(() =>
      db.delete(prdTags).where(and(eq(prdTags.prdId, prdId), eq(prdTags.tag, tag))),
    );
    return { prdId };
  });

/** List the tags attached to a PRD, sorted alphabetically. */
export const listTagsForPrd = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prdId = yield* resolvePrdIdFromRevision(prdRevisionId);
    const rows = yield* dbQuery(() =>
      db.query.prdTags.findMany({
        where: { prdId },
        orderBy: { tag: "asc" },
      }),
    );
    return rows.map((r: PrdTagRow) => r.tag);
  });

/**
 * List the head-revision rows of every PRD that carries `tag` in the given
 * project. Returns at most one row per logical PRD (the row pointed to by
 * `prds.currentRevisionId`), so it matches what `depot prd list` shows.
 */
export const listPrdsForTag = (projectId: string, tag: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows: PrdRevisionRow[] = yield* dbQuery(() =>
      db
        .select({
          id: prdRevisions.id,
          prdId: prdRevisions.prdId,
          projectId: prdRevisions.projectId,
          workspaceId: prdRevisions.workspaceId,
          revision: prdRevisions.revision,
          title: prdRevisions.title,
          context: prdRevisions.context,
          scope: prdRevisions.scope,
          problem: prdRevisions.problem,
          solution: prdRevisions.solution,
          implementationDecisions: prdRevisions.implementationDecisions,
          testingDecisions: prdRevisions.testingDecisions,
          status: prdRevisions.status,
          auditCycles: prdRevisions.auditCycles,
          currentPhase: prdRevisions.currentPhase,
          supersededAt: prdRevisions.supersededAt,
          suggestedCommitMessage: prdRevisions.suggestedCommitMessage,
          createdAt: prdRevisions.createdAt,
          updatedAt: prdRevisions.updatedAt,
          readyAt: prdRevisions.readyAt,
          activatedAt: prdRevisions.activatedAt,
        })
        .from(prdTags)
        .innerJoin(prds, eq(prds.id, prdTags.prdId))
        .innerJoin(prdRevisions, eq(prdRevisions.id, prds.currentRevisionId))
        .where(and(eq(prdTags.tag, tag), eq(prds.projectId, projectId)))
        .orderBy(asc(prdRevisions.createdAt)),
    );
    return rows;
  });

/** List the unique tags used across every PRD in a project, sorted alpha. */
export const listAllTagsForProject = (projectId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .selectDistinct({ tag: prdTags.tag })
        .from(prdTags)
        .innerJoin(prds, eq(prds.id, prdTags.prdId))
        .where(eq(prds.projectId, projectId))
        .orderBy(asc(prdTags.tag)),
    );
    return rows.map((r: { tag: string }) => r.tag);
  });

export type { PrdTagRow };
