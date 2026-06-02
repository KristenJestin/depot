import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { prds, prdRevisions } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { PrdNotFoundError, ValidationError } from "#/shared/errors";
import { logActivity } from "#/modules/activity/domain";
import { isValidMilestone, MAX_MILESTONE_LENGTH, type PrdStatus } from "#/shared/validator";
import { getPrd } from "#/modules/prds/domain";

/**
 * Milestone / `target_version` operations on the logical PRD entity (PRD
 * 0019 / T3). Callers pass a PRD *revision* ID (the ID returned by `depot
 * prd create` and used by every other `prd` subcommand). We resolve it to
 * the parent logical PRD and update `prds.target_version` there — the field
 * is intentionally not per-revision so a fork keeps the milestone link
 * without ceremony.
 *
 * Validation is permissive: any non-empty string up to 50 chars is accepted
 * (`isValidMilestone`). Semver, dates, codenames, themes all valid.
 */

/**
 * Set a PRD's milestone / target version. Resolves a PRD revision ID to its
 * logical PRD and updates `prds.target_version`. Idempotent: setting the
 * same value twice is a silent no-op (no UPDATE, no activity_log event).
 */
export const setMilestone = (prdRevisionId: string, version: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    if (!isValidMilestone(version)) {
      const trimmedLength = version.trim().length;
      const reason =
        trimmedLength === 0
          ? `Milestone must be non-empty.`
          : `Milestone is longer than the ${MAX_MILESTONE_LENGTH}-character limit (${trimmedLength}).`;
      return yield* Effect.fail(new ValidationError({ reason }));
    }

    const rev = yield* getPrd(prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));

    const logical = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: rev.prdId } }));
    if (!logical) return yield* Effect.fail(new PrdNotFoundError({ id: rev.prdId }));

    const previousVersion = logical.targetVersion ?? null;
    const newVersion = version.trim();

    if (previousVersion === newVersion) {
      return { prd: logical, changed: false as const, previousVersion, newVersion };
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prds)
        .set({ targetVersion: newVersion, updatedAt: new Date() })
        .where(eq(prds.id, logical.id))
        .returning(),
    );

    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: rev.id,
      eventType: "prd_milestone_set",
      payload: { prdId: logical.id, previousVersion, newVersion },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    return { prd: rows[0]!, changed: true as const, previousVersion, newVersion };
  });

/**
 * Clear a PRD's milestone / target version. Idempotent: unsetting an
 * already-null milestone is a silent no-op (no UPDATE, no activity_log event).
 */
export const unsetMilestone = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const rev = yield* getPrd(prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));

    const logical = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: rev.prdId } }));
    if (!logical) return yield* Effect.fail(new PrdNotFoundError({ id: rev.prdId }));

    const previousVersion = logical.targetVersion ?? null;
    if (previousVersion === null) {
      return { prd: logical, changed: false as const, previousVersion };
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prds)
        .set({ targetVersion: null, updatedAt: new Date() })
        .where(eq(prds.id, logical.id))
        .returning(),
    );

    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: rev.id,
      eventType: "prd_milestone_unset",
      payload: { prdId: logical.id, previousVersion, newVersion: null },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    return { prd: rows[0]!, changed: true as const, previousVersion };
  });

/**
 * Resolve the milestone-bearing PRD revisions in a project to their current
 * `prd_revisions` row. We project through `prds.currentRevisionId` so callers
 * see the head spec — earlier (superseded) revisions are not re-emitted.
 */
const listCurrentRevisionsForMilestone = (projectId: string, version: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const logical = yield* dbQuery(() =>
      db.query.prds.findMany({
        where: { projectId, targetVersion: version },
      }),
    );

    const result: (typeof prdRevisions.$inferSelect)[] = [];
    for (const p of logical) {
      if (!p.currentRevisionId) continue;
      const rev = yield* dbQuery(() =>
        db.query.prdRevisions.findFirst({ where: { id: p.currentRevisionId! } }),
      );
      if (rev) result.push(rev);
    }
    return result;
  });

/**
 * List the head PRD revisions in `projectId` whose logical PRD targets
 * `version`. Order is stable by `createdAt` ascending so reports are
 * deterministic.
 */
export const listPrdsByMilestone = (projectId: string, version: string) =>
  Effect.gen(function* () {
    const revs = yield* listCurrentRevisionsForMilestone(projectId, version);
    return revs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });

export type MilestoneSummary = {
  version: string;
  total: number;
  byStatus: Record<PrdStatus, number>;
};

const ZERO_BY_STATUS: Record<PrdStatus, number> = {
  draft: 0,
  ready: 0,
  in_progress: 0,
  review: 0,
  done: 0,
  canceled: 0,
};

/**
 * Aggregate PRD counts per status for `version` inside `projectId`. Always
 * returns every status key (zero-padded) so JSON consumers can render
 * deterministic dashboards without defensive coalescing.
 */
export const summaryByMilestone = (projectId: string, version: string) =>
  Effect.gen(function* () {
    const revs = yield* listCurrentRevisionsForMilestone(projectId, version);
    const byStatus: Record<PrdStatus, number> = { ...ZERO_BY_STATUS };
    for (const rev of revs) {
      byStatus[rev.status] = (byStatus[rev.status] ?? 0) + 1;
    }
    const summary: MilestoneSummary = { version, total: revs.length, byStatus };
    return summary;
  });
