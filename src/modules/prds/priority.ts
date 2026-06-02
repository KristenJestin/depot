import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { prds, prdRevisions } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { PrdNotFoundError, ValidationError } from "#/shared/errors";
import { logActivity } from "#/modules/activity/domain";
import { VALID_PRD_PRIORITIES, isValidPrdPriority, type PrdPriority } from "#/shared/validator";
import { getPrd } from "#/modules/prds/domain";

/**
 * Priority operations on the logical PRD entity (PRD 0019 / T5). Like
 * milestone / `target_version`, priority lives on `prds` (not on individual
 * revisions) so the value survives forks without ceremony. Callers pass a
 * PRD *revision* ID (the ID returned by every `prd` subcommand); we resolve
 * it to the parent logical PRD and update the column there.
 *
 * The default is `normal` — every existing row is backfilled with that value
 * by the migration and every newly-created PRD inherits it unless an
 * explicit priority is passed to `createPrd`.
 */

/**
 * Set a PRD's product priority. Idempotent: setting the same value twice is
 * a silent no-op (no UPDATE, no activity_log event). When the value changes,
 * a `prd_priority_changed` activity event is emitted carrying the previous
 * and new values so the dashboard can render a diff entry.
 */
export const setPriority = (prdRevisionId: string, priority: PrdPriority) =>
  Effect.gen(function* () {
    const db = yield* Db;

    if (!isValidPrdPriority(priority)) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Invalid priority '${priority}'. Valid priorities: ${VALID_PRD_PRIORITIES.join(", ")}.`,
        }),
      );
    }

    const rev = yield* getPrd(prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));

    const logical = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: rev.prdId } }));
    if (!logical) return yield* Effect.fail(new PrdNotFoundError({ id: rev.prdId }));

    const previousPriority = (logical.priority ?? "normal") as PrdPriority;
    if (previousPriority === priority) {
      return {
        prd: logical,
        changed: false as const,
        previousPriority,
        newPriority: priority,
      };
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prds)
        .set({ priority, updatedAt: new Date() })
        .where(eq(prds.id, logical.id))
        .returning(),
    );

    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: rev.id,
      eventType: "prd_priority_changed",
      payload: { prdId: logical.id, previousPriority, newPriority: priority },
      source: "human",
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    return {
      prd: rows[0]!,
      changed: true as const,
      previousPriority,
      newPriority: priority,
    };
  });

/**
 * Convenience wrapper: revert a PRD to `normal`. There is no `null` state for
 * priority (the column is `NOT NULL DEFAULT 'normal'`), so unset really just
 * delegates to `setPriority(..., "normal")`. Kept as a separate helper so the
 * CLI has a paired `set` / `unset` pair like the other PRD metadata
 * subcommands (tags, milestone).
 */
export const unsetPriority = (prdRevisionId: string) => setPriority(prdRevisionId, "normal");

/**
 * Resolve the priority-bearing PRD revisions in a project to their current
 * `prd_revisions` row. Projects through `prds.currentRevisionId` so callers
 * see the head spec — earlier (superseded) revisions are not re-emitted.
 */
const listCurrentRevisionsForPriority = (projectId: string, priority: PrdPriority) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const logical = yield* dbQuery(() =>
      db.query.prds.findMany({
        where: { projectId, priority },
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
 * List the head PRD revisions in `projectId` whose logical PRD has the given
 * `priority`. Order is stable by `createdAt` ascending so reports are
 * deterministic; callers (`depot prd list --priority`) sort again on top of
 * this when they need a different order.
 */
export const listPrdsByPriority = (projectId: string, priority: PrdPriority) =>
  Effect.gen(function* () {
    if (!isValidPrdPriority(priority)) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Invalid priority '${priority}'. Valid priorities: ${VALID_PRD_PRIORITIES.join(", ")}.`,
        }),
      );
    }
    const revs = yield* listCurrentRevisionsForPriority(projectId, priority);
    return revs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });
