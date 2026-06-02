import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { prdAnnexes, type PrdAnnexRow } from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import {
  AnnexExistsError,
  AnnexNotFoundError,
  PrdNotFoundError,
  ValidationError,
} from "#/shared/errors";
import { getPrd } from "#/modules/prds/domain";
import {
  invalidAnnexContentReason,
  invalidAnnexDescriptionReason,
  invalidAnnexNameReason,
  isValidAnnexKind,
  VALID_ANNEX_KINDS,
  type AnnexKind,
} from "#/shared/validator";

/**
 * Annex domain for PRDs (PRD 0024 / T1).
 *
 * An annex is a named text artifact attached to a PRD *revision* (substance,
 * recopied at fork — see `forkPrd`). The five helpers here are thin wrappers
 * over the `prd_annexes` table; all validation (name shape, kind enum, content
 * cap, description length) lives in `validateAnnexInput` so the CLI and the
 * future web API share a single source of truth.
 *
 * `extractAnnexRefs` is a pure helper (no DB) shared with `prd show` (broken
 * reference warning) and, later, the web chip renderer.
 */

type AnnexInput = {
  name: string;
  kind: AnnexKind;
  description?: string | null;
  content: string;
};

const validateAnnexInput = (input: AnnexInput) =>
  Effect.gen(function* () {
    const nameReason = invalidAnnexNameReason(input.name);
    if (nameReason !== null) {
      return yield* Effect.fail(new ValidationError({ reason: nameReason }));
    }
    if (!isValidAnnexKind(input.kind)) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Invalid annex kind '${input.kind}'. Valid kinds: ${VALID_ANNEX_KINDS.join(", ")}.`,
        }),
      );
    }
    const contentReason = invalidAnnexContentReason(input.content);
    if (contentReason !== null) {
      return yield* Effect.fail(new ValidationError({ reason: contentReason }));
    }
    if (input.description != null) {
      const descReason = invalidAnnexDescriptionReason(input.description);
      if (descReason !== null) {
        return yield* Effect.fail(new ValidationError({ reason: descReason }));
      }
    }
  });

/**
 * Attach a named text annex to a PRD revision.
 *
 * Fails with `AnnexExistsError` when an annex with the same `name` already
 * exists on the revision, unless `replace` is set — in which case the existing
 * row's content/kind/description are overwritten in place (its `id` and
 * `createdAt` are preserved). A non-existent revision raises `PrdNotFoundError`.
 */
export const addAnnex = (prdRevisionId: string, input: AnnexInput & { replace?: boolean }) =>
  Effect.gen(function* () {
    yield* validateAnnexInput(input);
    const db = yield* Db;

    const rev = yield* getPrd(prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));

    const existing = yield* dbQuery(() =>
      db.query.prdAnnexes.findFirst({ where: { prdRevisionId, name: input.name } }),
    );

    if (existing) {
      if (!input.replace) {
        return yield* Effect.fail(new AnnexExistsError({ prdRevisionId, name: input.name }));
      }
      const updated = yield* dbQuery(() =>
        db
          .update(prdAnnexes)
          .set({
            kind: input.kind,
            description: input.description ?? null,
            content: input.content,
          })
          .where(eq(prdAnnexes.id, existing.id))
          .returning(),
      );
      return updated[0]!;
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(prdAnnexes)
        .values({
          id: generateId(),
          prdRevisionId,
          name: input.name,
          kind: input.kind,
          description: input.description ?? null,
          content: input.content,
        })
        .returning(),
    );
    return rows[0]!;
  });

/** List a revision's annexes, ordered by name. Excludes nothing. */
export const listAnnexes = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: prdRevisionId }));
    return yield* dbQuery(() =>
      db.query.prdAnnexes.findMany({
        where: { prdRevisionId },
        orderBy: { name: "asc" },
      }),
    );
  });

/** Look up a single annex by its own id. Fails with `AnnexNotFoundError`. */
export const getAnnex = (annexId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.prdAnnexes.findFirst({ where: { id: annexId } }));
    if (!row) return yield* Effect.fail(new AnnexNotFoundError({ id: annexId }));
    return row;
  });

/**
 * Remove an annex by its own id. Fails with `AnnexNotFoundError` when the id is
 * unknown — `rm` is destructive, so a silent no-op would hide a typo. Returns
 * the deleted row so the CLI can attribute the `prd_annex_removed` event.
 */
export const removeAnnex = (annexId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.prdAnnexes.findFirst({ where: { id: annexId } }));
    if (!row) return yield* Effect.fail(new AnnexNotFoundError({ id: annexId }));
    yield* dbQuery(() => db.delete(prdAnnexes).where(eq(prdAnnexes.id, annexId)));
    return row;
  });

/**
 * Extract the annex names referenced inline in a PRD body via the
 * `[annex: <name>]` syntax. Pure, no DB. Used by `prd show` to warn about
 * broken references and (later) by the web renderer to draw chips.
 *
 * Names that don't match the kebab-case slug pattern are simply not captured
 * by the regex, so malformed mentions are ignored rather than reported.
 * Duplicate references collapse to a single entry, preserving first-seen order.
 */
export const extractAnnexRefs = (body: string | null | undefined): string[] => {
  if (!body) return [];
  const pattern = /\[annex:\s*([a-z0-9-]+)\]/g;
  const seen = new Set<string>();
  for (const match of body.matchAll(pattern)) {
    const name = match[1];
    if (name) seen.add(name);
  }
  return [...seen];
};

export type { PrdAnnexRow };
