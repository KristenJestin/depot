import { Effect } from "effect";
import { eq, max } from "drizzle-orm";
import { adrs, type AdrRow } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import {
  AdrNotFoundError,
  CrossEntityError,
  DatabaseError,
  InvalidTransitionError,
  ValidationError,
} from "#/shared/errors";
import type { AdrStatus } from "#/shared/validator";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateAdrInput = {
  projectId: string;
  prdId?: string | null;
  title: string;
  body: string;
};

export type ListAdrsFilter = {
  projectId?: string;
  prdId?: string;
  status?: AdrStatus;
};

export type AdrView = {
  adr: AdrRow;
  supersededBy: AdrRow | null;
  supersedes: AdrRow | null;
};

export type SupersedeAdrPayload = {
  title: string;
  body: string;
  prdId?: string | null;
};

export type SupersedeAdrResult = {
  oldAdr: AdrRow;
  newAdr: AdrRow;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a per-project ADR number as the human-readable ID, e.g. `ADR-0042`. */
export const formatAdrNumber = (n: number): string => `ADR-${String(n).padStart(4, "0")}`;

const assertNonEmpty = (
  value: string | undefined,
  field: "title" | "body",
): Effect.Effect<void, ValidationError, never> =>
  Effect.suspend(() => {
    if (value === undefined || value.trim().length === 0) {
      return Effect.fail(new ValidationError({ reason: `ADR ${field} must be non-empty` }));
    }
    return Effect.succeed(undefined);
  });

/**
 * Validate a non-null `prdId` belongs to the given project. Returns silently
 * when `prdId` is null/undefined (project-wide ADR, no linkage to check).
 */
const assertPrdInProject = (prdId: string | null | undefined, projectId: string) =>
  Effect.gen(function* () {
    if (prdId === null || prdId === undefined) return;
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: prdId } }));
    if (!row) {
      return yield* Effect.fail(new ValidationError({ reason: `PRD not found: ${prdId}` }));
    }
    if (row.projectId !== projectId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `PRD '${prdId}' does not belong to project '${projectId}' (must be the same project as the ADR)`,
        }),
      );
    }
  });

// ── createAdr ─────────────────────────────────────────────────────────────────

/**
 * Create a new ADR in `proposed` status with a contiguous per-project number.
 *
 * The number allocation runs inside a transaction (`SELECT MAX(number) + 1`
 * then INSERT) so two concurrent creates can't collide. The unique index on
 * `(project_id, number)` is the last-line guard.
 */
export const createAdr = (input: CreateAdrInput) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* assertNonEmpty(input.title, "title");
    yield* assertNonEmpty(input.body, "body");
    yield* assertPrdInProject(input.prdId ?? null, input.projectId);

    const id = generateId();
    const row = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          const next = tx
            .select({ maxNum: max(adrs.number) })
            .from(adrs)
            .where(eq(adrs.projectId, input.projectId))
            .all()[0];
          const number = (next?.maxNum ?? 0) + 1;
          const rows = tx
            .insert(adrs)
            .values({
              id,
              projectId: input.projectId,
              prdId: input.prdId ?? null,
              number,
              title: input.title,
              status: "proposed",
              body: input.body,
              supersededByAdrId: null,
            })
            .returning()
            .all();
          return rows[0]!;
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });
    return row;
  });

// ── listAdrs ──────────────────────────────────────────────────────────────────

export const listAdrs = (filter: ListAdrsFilter = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const where: Record<string, unknown> = {};
    if (filter.projectId !== undefined) where["projectId"] = filter.projectId;
    if (filter.prdId !== undefined) where["prdId"] = filter.prdId;
    if (filter.status !== undefined) where["status"] = filter.status;
    return yield* dbQuery(() =>
      db.query.adrs.findMany({
        where,
        orderBy: { number: "asc" },
      }),
    );
  });

// ── getAdr ────────────────────────────────────────────────────────────────────

/**
 * Fetch an ADR along with its superseding context:
 * - `supersededBy`: the newer ADR that replaced this one (if any).
 * - `supersedes`: the older ADR this one replaced (if any).
 */
export const getAdr = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.adrs.findFirst({ where: { id } }));
    if (!row) return null;

    const supersededBy: AdrRow | null = row.supersededByAdrId
      ? ((yield* dbQuery(() =>
          db.query.adrs.findFirst({ where: { id: row.supersededByAdrId! } }),
        )) ?? null)
      : null;

    const supersedes: AdrRow | null =
      (yield* dbQuery(() => db.query.adrs.findFirst({ where: { supersededByAdrId: row.id } }))) ??
      null;

    return { adr: row, supersededBy, supersedes } satisfies AdrView;
  });

// ── acceptAdr ─────────────────────────────────────────────────────────────────

export const acceptAdr = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.adrs.findFirst({ where: { id } }));
    if (!row) return yield* Effect.fail(new AdrNotFoundError({ id }));
    if (row.status !== "proposed") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          entity: "adr",
          from: row.status,
          to: "accepted",
          allowed: [],
        }),
      );
    }
    const rows = yield* dbQuery(() =>
      db.update(adrs).set({ status: "accepted" }).where(eq(adrs.id, id)).returning(),
    );
    return rows[0]!;
  });

// ── supersedeAdr ──────────────────────────────────────────────────────────────

/**
 * Replace an older ADR with a new one in a single transaction.
 *
 * - Creates a new ADR (`status = accepted`, fresh contiguous number) in the
 *   same project as the old one.
 * - Marks the old ADR `superseded` with `supersededByAdrId` pointing at the
 *   new ADR.
 *
 * Rejects when the old ADR is already `superseded`.
 */
export const supersedeAdr = (oldId: string, payload: SupersedeAdrPayload) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* assertNonEmpty(payload.title, "title");
    yield* assertNonEmpty(payload.body, "body");

    const old = yield* dbQuery(() => db.query.adrs.findFirst({ where: { id: oldId } }));
    if (!old) return yield* Effect.fail(new AdrNotFoundError({ id: oldId }));
    if (old.status === "superseded") {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot supersede ADR '${oldId}': it is already superseded by '${old.supersededByAdrId ?? "?"}'`,
        }),
      );
    }

    yield* assertPrdInProject(payload.prdId ?? null, old.projectId);

    const result = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          const next = tx
            .select({ maxNum: max(adrs.number) })
            .from(adrs)
            .where(eq(adrs.projectId, old.projectId))
            .all()[0];
          const number = (next?.maxNum ?? 0) + 1;
          const newId = generateId();

          const newRows = tx
            .insert(adrs)
            .values({
              id: newId,
              projectId: old.projectId,
              prdId: payload.prdId ?? null,
              number,
              title: payload.title,
              status: "accepted",
              body: payload.body,
              supersededByAdrId: null,
            })
            .returning()
            .all();
          const newAdr = newRows[0]!;

          const oldRows = tx
            .update(adrs)
            .set({ status: "superseded", supersededByAdrId: newId })
            .where(eq(adrs.id, old.id))
            .returning()
            .all();
          const oldAdr = oldRows[0]!;

          return { oldAdr, newAdr } satisfies SupersedeAdrResult;
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });
    return result;
  });

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied ADR reference within a project to an ADR row.
 * Accepts the full ULID `id`, the `ADR-XXXX` form, or a bare integer (the
 * per-project number). Returns `null` when nothing matches.
 */
export const resolveAdrRef = (projectId: string, ref: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const trimmed = ref.trim();
    const adrMatch = /^ADR-?(\d+)$/i.exec(trimmed);
    const numericMatch = adrMatch ? adrMatch[1] : /^\d+$/.test(trimmed) ? trimmed : null;
    if (numericMatch !== null) {
      const number = Number.parseInt(numericMatch, 10);
      const byNumber = yield* dbQuery(() =>
        db.query.adrs.findFirst({ where: { projectId, number } }),
      );
      return byNumber ?? null;
    }
    const byId = yield* dbQuery(() =>
      db.query.adrs.findFirst({ where: { id: trimmed, projectId } }),
    );
    return byId ?? null;
  });

// Re-export for callers that want to import from one place.
export type { AdrRow };
