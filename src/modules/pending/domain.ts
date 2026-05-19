import { Effect } from "effect";
import { eq, and, lt, asc } from "drizzle-orm";
import { pendingActions } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import { ValidationError } from "#/shared/errors";
import type { ActivitySource, PendingActionKind, PendingActionStatus } from "#/shared/validator";

export const pushPendingAction = (input: {
  projectId: string;
  kind: PendingActionKind;
  slashCommand: string;
  humanReadableLabel: string;
  payload?: Record<string, unknown>;
  sourcePrdId?: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    // Dedup: refuse to create a second `pending` action with same
    // (kind, sourcePrdId, slashCommand); return the existing row instead.
    const existing = yield* dbQuery(() =>
      db.query.pendingActions.findFirst({
        where: {
          projectId: input.projectId,
          kind: input.kind,
          slashCommand: input.slashCommand,
          status: "pending",
          ...(input.sourcePrdId ? { sourcePrdId: input.sourcePrdId } : {}),
        },
      }),
    );
    if (existing) return existing;

    const rows = yield* dbQuery(() =>
      db
        .insert(pendingActions)
        .values({
          id: generateId(),
          projectId: input.projectId,
          kind: input.kind,
          payload: JSON.stringify(input.payload ?? {}),
          status: "pending",
          sourcePrdId: input.sourcePrdId ?? null,
          slashCommand: input.slashCommand,
          humanReadableLabel: input.humanReadableLabel,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listPendingActions = (
  projectId: string,
  options: { status?: PendingActionStatus; limit?: number } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const where = options.status ? { projectId, status: options.status } : { projectId };
    return yield* dbQuery(() =>
      db.query.pendingActions.findMany({
        where,
        orderBy: { createdAt: "desc" },
        limit: options.limit,
      }),
    );
  });

export const getPendingAction = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() => db.query.pendingActions.findFirst({ where: { id } }));
  });

export const consumePendingAction = (id: string, source: ActivitySource = "ai") =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .update(pendingActions)
        .set({ status: "consumed", consumedAt: new Date(), consumedBySource: source })
        .where(eq(pendingActions.id, id))
        .returning(),
    );
    if (rows.length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: `Pending action not found: ${id}` }));
    }
    return rows[0]!;
  });

export const dismissPendingAction = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .update(pendingActions)
        .set({ status: "dismissed" })
        .where(eq(pendingActions.id, id))
        .returning(),
    );
    return rows[0] ?? null;
  });

export const pruneOldDismissed = (options: { olderThan: Date }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(pendingActions)
        .where(
          and(
            eq(pendingActions.status, "dismissed"),
            lt(pendingActions.createdAt, options.olderThan),
          )!,
        ),
    );
    return options.olderThan;
  });

/**
 * Auto-dismiss every pending action older than `ttlDays`. Called by
 * `depot pending list` and `depot pending tick` as a lazy housekeeping
 * pass so we don't need a cron daemon. Returns the IDs that flipped.
 */
export const autoDismissExpired = (projectId: string, ttlDays: number) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const threshold = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const expired = yield* dbQuery(() =>
      db.query.pendingActions.findMany({
        where: { projectId, status: "pending" },
      }),
    );
    const toFlip = expired.filter((row) => row.createdAt < threshold);
    for (const row of toFlip) {
      yield* dbQuery(() =>
        db.update(pendingActions).set({ status: "dismissed" }).where(eq(pendingActions.id, row.id)),
      );
    }
    return toFlip.map((row) => row.id);
  });

// Re-export ordering helpers to suppress unused warnings for future use.
void asc;
