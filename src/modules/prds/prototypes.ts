import { Effect } from "effect";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  prdPrototypes,
  prdPrototypePages,
  prdPrototypePageVersions,
  prdPrototypeVariants,
  prdPrototypeFeedback,
  prdPrototypeRounds,
  prdPrototypeRoundPages,
  prdRoundPageDesign,
  taskPrototypePages,
  type PrdPrototypeRow,
  type PrdPrototypePageRow,
  type PrdPrototypePageVersionRow,
  type PrdPrototypeVariantRow,
  type PrdPrototypeFeedbackRow,
  type PrdPrototypeRoundRow,
  type PrdPrototypeRoundPageRow,
  type PrdRoundPageDesignRow,
} from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import {
  FeedbackNotFoundError,
  FeedbackOnStaleVersionError,
  PrdNotFoundError,
  PrototypeExistsError,
  PrototypeNotFoundError,
  PrototypePageExistsError,
  PrototypePageNotFoundError,
  PrototypePageNotFoundInPrototypeError,
  PrototypeVariantExistsError,
  PrototypeVariantExternalResourcesError,
  PrototypeVariantNotFoundError,
  PrototypeVersionExistsError,
  PrototypeVersionNotFoundError,
  PrototypeRoundNotFoundError,
  PrototypeRoundLabelExistsError,
  ValidationError,
} from "#/shared/errors";
import { getPrd } from "#/modules/prds/domain";
import { invalidPrototypeSlugReason, type FeedbackStatus } from "#/shared/validator";

/**
 * Prototype domain (PRD 0025 / T1).
 *
 * Five entities — Prototype, Page, PageVersion, Variant, Feedback — and one
 * resolver (`resolveVariant`). The module owns three invariants the SQL
 * schema cannot express on its own:
 *
 * 1. Slug / label shape (kebab-case, ≤ 60 chars) for prototype/page/version/variant.
 * 2. Exactly one `is_main = 1` per `page_version_id` — transitioned atomically
 *    by `setMainVariant` and seeded by the first variant added to a fresh
 *    version.
 * 3. Feedback creation is refused when the targeted variant is not on the
 *    latest non-archived version of its page (mapped to 409 by the web API).
 *
 * Everything is additive: archiving a version or removing a variant never
 * mutates an older variant in place, so the "addressed" derived feedback
 * bucket the renderer surfaces (open feedback on a stale version) stays
 * well-defined.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const validateSlug = (value: string, label: string) =>
  Effect.gen(function* () {
    const reason = invalidPrototypeSlugReason(value);
    if (reason !== null) {
      return yield* Effect.fail(new ValidationError({ reason: `${label}: ${reason}` }));
    }
  });

/**
 * Resolve the latest non-archived `page_version` of a page. Returns `null`
 * when the page has no active version (all archived or none ever created).
 */
const getLatestActiveVersionForPage = (pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    // Secondary sort on `id` (ulid, monotonic) keeps the result deterministic
    // when two versions share a millisecond timestamp.
    const rows = yield* dbQuery(() =>
      db
        .select()
        .from(prdPrototypePageVersions)
        .where(
          and(
            eq(prdPrototypePageVersions.pageId, pageId),
            isNull(prdPrototypePageVersions.archivedAt),
          ),
        )
        .orderBy(desc(prdPrototypePageVersions.createdAt), desc(prdPrototypePageVersions.id))
        .limit(1),
    );
    return rows[0] ?? null;
  });

// ── Prototypes ───────────────────────────────────────────────────────────────

export const createPrototype = (input: {
  prdRevisionId: string;
  slug: string;
  description?: string | null;
}) =>
  Effect.gen(function* () {
    yield* validateSlug(input.slug, "prototype slug");
    const db = yield* Db;
    const rev = yield* getPrd(input.prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: input.prdRevisionId }));

    const existing = yield* dbQuery(() =>
      db.query.prdPrototypes.findFirst({
        where: { prdRevisionId: input.prdRevisionId, slug: input.slug },
      }),
    );
    if (existing) {
      return yield* Effect.fail(
        new PrototypeExistsError({
          prdRevisionId: input.prdRevisionId,
          slug: input.slug,
        }),
      );
    }

    const newId = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypes)
        .values({
          id: newId,
          prdRevisionId: input.prdRevisionId,
          slug: input.slug,
          description: input.description ?? null,
        })
        .returning(),
    );
    // Every prototype always has a current round; seed an empty `v1` so the
    // round manifest is well-defined from the first moment (PRD 0029 / A).
    yield* createRound({ prototypeId: newId, label: "v1" });
    return rows[0]!;
  });

export const listPrototypes = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPrototypes.findMany({
        where: { prdRevisionId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

export const getPrototype = (prototypeId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypes.findFirst({ where: { id: prototypeId } }),
    );
    if (!row) return yield* Effect.fail(new PrototypeNotFoundError({ id: prototypeId }));
    return row;
  });

export const archivePrototype = (prototypeId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* getPrototype(prototypeId);
    yield* dbQuery(() =>
      db
        .update(prdPrototypes)
        .set({ archivedAt: new Date() })
        .where(eq(prdPrototypes.id, prototypeId)),
    );
    return { ...row, archivedAt: new Date() };
  });

// ── Pages ────────────────────────────────────────────────────────────────────

export const addPage = (input: {
  prototypeId: string;
  slug: string;
  title: string;
  position?: number;
}) =>
  Effect.gen(function* () {
    yield* validateSlug(input.slug, "page slug");
    if (input.title.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: "page title must not be empty" }));
    }
    const db = yield* Db;
    yield* getPrototype(input.prototypeId);

    const existing = yield* dbQuery(() =>
      db.query.prdPrototypePages.findFirst({
        where: { prototypeId: input.prototypeId, slug: input.slug },
      }),
    );
    if (existing) {
      return yield* Effect.fail(
        new PrototypePageExistsError({
          prototypeId: input.prototypeId,
          slug: input.slug,
        }),
      );
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypePages)
        .values({
          id: generateId(),
          prototypeId: input.prototypeId,
          slug: input.slug,
          title: input.title,
          position: input.position ?? 0,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listPages = (prototypeId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPrototypePages.findMany({
        where: { prototypeId },
        orderBy: { position: "asc", createdAt: "asc" },
      }),
    );
  });

export const getPage = (pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypePages.findFirst({ where: { id: pageId } }),
    );
    if (!row) return yield* Effect.fail(new PrototypePageNotFoundError({ id: pageId }));
    return row;
  });

/**
 * Remove a page. With `cascade=true`, also removes every version + variant +
 * feedback under it in a single transaction. Without cascade, the call fails
 * loudly if the page has any version (the user has to archive explicitly).
 */
export const removePage = (pageId: string, options: { cascade?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const page = yield* getPage(pageId);

    const versions = yield* dbQuery(() =>
      db.query.prdPrototypePageVersions.findMany({ where: { pageId } }),
    );
    if (versions.length > 0 && !options.cascade) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot remove page ${pageId}: ${versions.length} version(s) attached. Pass --cascade to remove them and their variants/feedback, or archive the versions individually.`,
        }),
      );
    }

    // Drop the page from every round manifest first — those rows FK both
    // `pageId` and `pageVersionId`, so they must go before the versions and the
    // page itself are deleted. The distilled placement rows FK `pageId` too, so
    // they go alongside the manifest rows.
    yield* dbQuery(() =>
      db.delete(taskPrototypePages).where(eq(taskPrototypePages.pageId, pageId)),
    );
    yield* dbQuery(() =>
      db.delete(prdRoundPageDesign).where(eq(prdRoundPageDesign.pageId, pageId)),
    );
    yield* dbQuery(() =>
      db.delete(prdPrototypeRoundPages).where(eq(prdPrototypeRoundPages.pageId, pageId)),
    );

    if (versions.length > 0) {
      const versionIds = versions.map((v) => v.id);
      const variants = yield* dbQuery(() =>
        db
          .select({ id: prdPrototypeVariants.id })
          .from(prdPrototypeVariants)
          .where(inArray(prdPrototypeVariants.pageVersionId, versionIds)),
      );
      const variantIds = variants.map((v) => v.id);
      if (variantIds.length > 0) {
        yield* dbQuery(() =>
          db
            .delete(prdPrototypeFeedback)
            .where(inArray(prdPrototypeFeedback.variantId, variantIds)),
        );
        yield* dbQuery(() =>
          db.delete(prdPrototypeVariants).where(inArray(prdPrototypeVariants.id, variantIds)),
        );
      }
      yield* dbQuery(() =>
        db.delete(prdPrototypePageVersions).where(inArray(prdPrototypePageVersions.id, versionIds)),
      );
    }
    yield* dbQuery(() => db.delete(prdPrototypePages).where(eq(prdPrototypePages.id, pageId)));
    return page;
  });

// ── Page versions ────────────────────────────────────────────────────────────

export const addVersion = (input: { pageId: string; label: string; summary?: string | null }) =>
  Effect.gen(function* () {
    yield* validateSlug(input.label, "version label");
    const db = yield* Db;
    const page = yield* getPage(input.pageId);

    const priorVersions = yield* dbQuery(() =>
      db.query.prdPrototypePageVersions.findMany({
        where: { pageId: input.pageId },
        columns: { id: true, label: true },
      }),
    );
    if (priorVersions.some((v) => v.label === input.label)) {
      return yield* Effect.fail(
        new PrototypeVersionExistsError({
          pageId: input.pageId,
          label: input.label,
        }),
      );
    }

    const newVersionId = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypePageVersions)
        .values({
          id: newVersionId,
          pageId: input.pageId,
          label: input.label,
          summary: input.summary ?? null,
        })
        .returning(),
    );

    // Keep the current round's manifest tracking this page: advance an
    // existing pin to the new version, or auto-include the page on its very
    // first version so a freshly authored page enters the current design round
    // naturally. A page that already had versions but is no longer in the
    // manifest was dropped on purpose — leave it out (re-inclusion is explicit).
    const current = yield* getCurrentRound(page.prototypeId);
    if (current) {
      const entry = yield* dbQuery(() =>
        db.query.prdPrototypeRoundPages.findFirst({
          where: { roundId: current.id, pageId: input.pageId },
        }),
      );
      if (entry) {
        yield* includePage(current.id, input.pageId, newVersionId);
      } else if (priorVersions.length === 0) {
        yield* includePage(current.id, input.pageId, newVersionId);
      }
    }

    return rows[0]!;
  });

export const listVersions = (pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPrototypePageVersions.findMany({
        where: { pageId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

export const getVersion = (versionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypePageVersions.findFirst({ where: { id: versionId } }),
    );
    if (!row) return yield* Effect.fail(new PrototypeVersionNotFoundError({ id: versionId }));
    return row;
  });

export const archiveVersion = (versionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* getVersion(versionId);
    yield* dbQuery(() =>
      db
        .update(prdPrototypePageVersions)
        .set({ archivedAt: new Date() })
        .where(eq(prdPrototypePageVersions.id, versionId)),
    );
    return row;
  });

export const restoreVersion = (versionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* getVersion(versionId);
    yield* dbQuery(() =>
      db
        .update(prdPrototypePageVersions)
        .set({ archivedAt: null })
        .where(eq(prdPrototypePageVersions.id, versionId)),
    );
    return row;
  });

// ── Variants ─────────────────────────────────────────────────────────────────

/**
 * Detect external resources the sandboxed prototype iframe cannot load. The
 * iframe runs with `sandbox="allow-scripts"` (no `allow-same-origin`) under a
 * `default-src 'none'` CSP that only whitelists inline styles, a per-request
 * shim nonce, and `data:` images/fonts. Anything pulled over http(s) — most
 * notably the Tailwind Play CDN, external `<script src>`, and external
 * `<link href>` — silently fails to load, leaving the variant blank.
 *
 * Heuristic and line-oriented on purpose: it flags the documented offenders
 * without parsing HTML. Plain `<a href="http…">` hyperlinks are NOT flagged —
 * they navigate, they don't load a blocked sub-resource.
 */
const TAILWIND_CDN_RE = /cdn\.tailwindcss\.com/i;
const EXTERNAL_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i;
const EXTERNAL_LINK_RE = /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i;

export const lintSelfContainedHtml = (
  html: string,
): { line: number; reason: string; snippet: string }[] => {
  const findings: { line: number; reason: string; snippet: string }[] = [];
  const lines = html.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const snippet = line.trim().slice(0, 100);
    if (TAILWIND_CDN_RE.test(line)) {
      findings.push({ line: i + 1, reason: "Tailwind CDN (cdn.tailwindcss.com)", snippet });
      continue;
    }
    if (EXTERNAL_SCRIPT_RE.test(line)) {
      findings.push({ line: i + 1, reason: 'external <script src="http…">', snippet });
    }
    if (EXTERNAL_LINK_RE.test(line)) {
      findings.push({ line: i + 1, reason: 'external <link href="http…">', snippet });
    }
  }
  return findings;
};

/**
 * Add a variant to a page version. The first variant added to a fresh version
 * is promoted to `is_main` automatically; subsequent variants stay non-main
 * unless `markMain` is explicitly true, in which case the existing main is
 * demoted and the new variant takes its place — both writes happen in one
 * transaction so the "exactly 1 main per version" invariant is never broken.
 */
export const addVariant = (input: {
  pageVersionId: string;
  label: string;
  title: string;
  htmlContent: string;
  position?: number;
  markMain?: boolean;
  allowExternal?: boolean;
}) =>
  Effect.gen(function* () {
    yield* validateSlug(input.label, "variant label");
    if (input.title.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: "variant title must not be empty" }));
    }
    if (input.htmlContent.length === 0) {
      return yield* Effect.fail(
        new ValidationError({ reason: "variant html_content must not be empty" }),
      );
    }
    if (input.allowExternal !== true) {
      const externals = lintSelfContainedHtml(input.htmlContent);
      if (externals.length > 0) {
        return yield* Effect.fail(
          new PrototypeVariantExternalResourcesError({ resources: externals }),
        );
      }
    }
    const db = yield* Db;
    yield* getVersion(input.pageVersionId);

    const existing = yield* dbQuery(() =>
      db.query.prdPrototypeVariants.findFirst({
        where: { pageVersionId: input.pageVersionId, label: input.label },
      }),
    );
    if (existing) {
      return yield* Effect.fail(
        new PrototypeVariantExistsError({
          pageVersionId: input.pageVersionId,
          label: input.label,
        }),
      );
    }

    const siblings = yield* dbQuery(() =>
      db.query.prdPrototypeVariants.findMany({
        where: { pageVersionId: input.pageVersionId },
      }),
    );
    const hasMain = siblings.some((s) => s.isMain);
    const shouldBeMain = input.markMain === true || siblings.length === 0;

    if (input.markMain === true && hasMain) {
      yield* dbQuery(() =>
        db
          .update(prdPrototypeVariants)
          .set({ isMain: false })
          .where(eq(prdPrototypeVariants.pageVersionId, input.pageVersionId)),
      );
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypeVariants)
        .values({
          id: generateId(),
          pageVersionId: input.pageVersionId,
          label: input.label,
          title: input.title,
          htmlContent: input.htmlContent,
          isMain: shouldBeMain,
          position: input.position ?? siblings.length,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listVariants = (pageVersionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPrototypeVariants.findMany({
        where: { pageVersionId },
        orderBy: { position: "asc", createdAt: "asc" },
      }),
    );
  });

export const getVariant = (variantId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypeVariants.findFirst({ where: { id: variantId } }),
    );
    if (!row) return yield* Effect.fail(new PrototypeVariantNotFoundError({ id: variantId }));
    return row;
  });

export const removeVariant = (variantId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* getVariant(variantId);
    // No FK backs `chosen_variant_id`, so clear any election on this variant
    // before deleting it — the election must never dangle (PRD 0028 / 0030).
    // The election now lives on the `(round, page)` manifest row, so clear every
    // manifest row that elected it; the legacy page-level column is also cleared
    // for the rows the migration kept additive.
    yield* dbQuery(() =>
      db
        .update(prdPrototypeRoundPages)
        .set({ chosenVariantId: null, decisionRationale: null, decidedBy: null, decidedAt: null })
        .where(eq(prdPrototypeRoundPages.chosenVariantId, variantId)),
    );
    yield* dbQuery(() =>
      db
        .update(prdPrototypePages)
        .set({ chosenVariantId: null, decisionRationale: null, decidedBy: null, decidedAt: null })
        .where(eq(prdPrototypePages.chosenVariantId, variantId)),
    );
    yield* dbQuery(() =>
      db.delete(prdPrototypeFeedback).where(eq(prdPrototypeFeedback.variantId, variantId)),
    );
    yield* dbQuery(() =>
      db.delete(prdPrototypeVariants).where(eq(prdPrototypeVariants.id, variantId)),
    );
    return row;
  });

/**
 * Atomic main-variant promotion. Demotes the current main on the same page
 * version (if any), then promotes the target. The two writes happen in the
 * same transaction so a crash can never leave a version with zero or two
 * mains.
 */
export const setMainVariant = (variantId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const target = yield* getVariant(variantId);

    const currentMain = yield* dbQuery(() =>
      db.query.prdPrototypeVariants.findFirst({
        where: { pageVersionId: target.pageVersionId, isMain: true },
      }),
    );
    const previousMainId = currentMain?.id ?? null;

    // node:sqlite's sync driver rejects an async transaction callback; we
    // serialise the two writes via the sync `transaction` overload by
    // performing them back-to-back inside a single `dbQuery` so they share
    // the same SQLite connection. The unique index on `(page_version_id,
    // label)` doubles as a last-line guard against an intermediate state.
    // node:sqlite's sync driver rejects an async transaction callback; we
    // serialise the two writes via the sync `transaction` overload by
    // performing them back-to-back inside a single `dbQuery` so they share
    // the same SQLite connection. The unique index on `(page_version_id,
    // label)` doubles as a last-line guard against an intermediate state.
    yield* dbQuery(async () => {
      db.transaction((tx) => {
        tx.update(prdPrototypeVariants)
          .set({ isMain: false })
          .where(eq(prdPrototypeVariants.pageVersionId, target.pageVersionId))
          .run();
        tx.update(prdPrototypeVariants)
          .set({ isMain: true })
          .where(eq(prdPrototypeVariants.id, variantId))
          .run();
      });
    });

    return { variant: { ...target, isMain: true }, previousMainId };
  });

// ── Election (PRD 0028 / 0030 — round-scoped design lock) ─────────────────────
//
// The election (chosen variant + arbitration record) lives on the round's
// manifest row `prd_prototype_round_pages` — keyed by `(round, page)` — so each
// design round carries its OWN decision (PRD 0030 / issue 01). Re-opening or
// cloning a round inherits the election; advancing a page's pinned version
// resets it (the decision was about the old variant). The current round is the
// default target; an explicit `roundId` scopes the operation to that round.

/**
 * The election decision as it lives on a `(round, page)` manifest row, joined
 * with the page it concerns so callers (web/CLI) can reach `page.prototypeId` /
 * `page.slug` without a second round-trip. `electVariant` / `clearElection`
 * return this shape.
 */
export type RoundPageElection = PrdPrototypeRoundPageRow & {
  page: PrdPrototypePageRow;
};

/** Resolve the manifest row for `(round, page)`, or `null` when absent. */
export const getRoundPageEntry = (roundId: string, pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypeRoundPages.findFirst({
        where: { roundId, pageId },
      }),
    );
    return row ?? null;
  });

/**
 * Elect a variant as THE design to build for its page, scoped to a round
 * (PRD 0028 / 0030). This is the product decision, distinct from `is_main` (a
 * per-version primacy hint): a `(round, page)` has at most one elected variant,
 * recorded on the round's manifest row together with the arbitration record
 * (`rationale` / `decidedBy` / `decidedAt`). The dev handoff reads this, not the
 * raw mockups. Re-electing overwrites the previous choice for that round.
 *
 * The target round is the page's prototype current round by default, or the
 * explicit `roundId`. The page must be in that round's manifest — electing a
 * page the round dropped is a `ValidationError`.
 */
export const electVariant = (
  variantId: string,
  options: { rationale: string; decidedBy?: string | null; roundId?: string | null },
) =>
  Effect.gen(function* () {
    if (options.rationale.trim().length === 0) {
      return yield* Effect.fail(
        new ValidationError({ reason: "election rationale must not be empty" }),
      );
    }
    const db = yield* Db;
    const variant = yield* getVariant(variantId);
    const version = yield* getVersion(variant.pageVersionId);
    const page = yield* getPage(version.pageId);

    const round = options.roundId
      ? yield* getRound(options.roundId)
      : yield* getCurrentRound(page.prototypeId);
    if (!round) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `cannot elect: prototype ${page.prototypeId} has no round`,
        }),
      );
    }
    const entry = yield* getRoundPageEntry(round.id, page.id);
    if (!entry) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `cannot elect: page ${page.id} is not in round ${round.id}`,
        }),
      );
    }
    if (entry.pageVersionId !== variant.pageVersionId) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `cannot elect: variant ${variantId} belongs to version ${variant.pageVersionId}, but round ${round.id} pins version ${entry.pageVersionId} for page ${page.id}`,
        }),
      );
    }

    const updated = yield* dbQuery(() =>
      db
        .update(prdPrototypeRoundPages)
        .set({
          chosenVariantId: variantId,
          decisionRationale: options.rationale.trim(),
          decidedBy: options.decidedBy ?? null,
          decidedAt: new Date(),
        })
        .where(eq(prdPrototypeRoundPages.id, entry.id))
        .returning(),
    );
    return { ...updated[0]!, page } satisfies RoundPageElection;
  });

/**
 * Clear the election on a `(round, page)`, reverting it to "no design chosen
 * yet" for that round. The target round is the page's current round by default,
 * or the explicit `roundId`. A page not in the round's manifest is a no-op (the
 * round had no decision to clear).
 */
export const clearElection = (pageId: string, options: { roundId?: string | null } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const page = yield* getPage(pageId);

    const round = options.roundId
      ? yield* getRound(options.roundId)
      : yield* getCurrentRound(page.prototypeId);
    if (!round) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `cannot clear election: prototype ${page.prototypeId} has no round`,
        }),
      );
    }
    const entry = yield* getRoundPageEntry(round.id, pageId);
    if (!entry) {
      return {
        id: "",
        roundId: round.id,
        pageId,
        pageVersionId: "",
        position: 0,
        chosenVariantId: null,
        decisionRationale: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: round.createdAt,
        page,
      } satisfies RoundPageElection;
    }
    const updated = yield* dbQuery(() =>
      db
        .update(prdPrototypeRoundPages)
        .set({ chosenVariantId: null, decisionRationale: null, decidedBy: null, decidedAt: null })
        .where(eq(prdPrototypeRoundPages.id, entry.id))
        .returning(),
    );
    return { ...updated[0]!, page } satisfies RoundPageElection;
  });

// ── Placement (PRD 0030 / issue 02 — per-(round, page) distilled layout) ──────
//
// The distilled placement spec lives on the `(round, page)` in its own table
// (`prd_round_page_design`), out of the manifest hot path. It is authored on the
// fly as soon as the page's variant is decided in the round, inherited when a
// round is cloned, and reset (row removed) when the page's pinned version
// advances — mirroring the round-scoped election.

/**
 * Resolve the distilled placement of a `(round, page)`, or `null` when the page
 * has not been distilled in that round yet.
 */
export const getRoundPagePlacement = (roundId: string, pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdRoundPageDesign.findFirst({ where: { roundId, pageId } }),
    );
    return row ?? null;
  });

/**
 * The placement markdown is structured by convention (Regions / Order /
 * Hierarchy / States / Interactions). The light guard requires only the two key
 * sections — `## Regions` and `## Order` — so a simple page need not fill every
 * section while a spec that skips the load-bearing layout zones is refused.
 */
const requireKeyPlacementSections = (spec: string) => {
  const hasSection = (name: string) => new RegExp(`^#{1,6}\\s+${name}\\b`, "im").test(spec);
  const missing: string[] = [];
  if (!hasSection("Regions")) missing.push("## Regions");
  if (!hasSection("Order")) missing.push("## Order");
  return missing;
};

/**
 * Distill (author/update) the placement of a `(round, page)` — the validated
 * layout the dev/coder implements (PRD 0030 / issue 02). Replaces the PRD-level
 * `distillDesign` for prototypes: the placement is per `(round, page)`, not one
 * global blob. Upserts on `(round, page)`. Refuses an empty spec, a page not in
 * the round's manifest, and a spec missing the key sections `## Regions` /
 * `## Order`. Idempotent: re-distilling overwrites the spec and refreshes
 * `distilledAt`.
 */
export const distillPagePlacement = (
  roundId: string,
  pageId: string,
  input: { placementSpec: string },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const round = yield* getRound(roundId);
    const page = yield* getPage(pageId);

    const trimmed = input.placementSpec.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(
        new ValidationError({ reason: "placement spec must not be empty" }),
      );
    }
    const missing = requireKeyPlacementSections(trimmed);
    if (missing.length > 0) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `placement spec is missing the key section(s) ${missing.join(", ")} — a placement is structured by convention (Regions / Order / Hierarchy / States / Interactions) and must at least describe its Regions and Order`,
        }),
      );
    }

    const entry = yield* getRoundPageEntry(round.id, page.id);
    if (!entry) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `cannot distill: page ${page.id} is not in round ${round.id}`,
        }),
      );
    }

    const distilledAt = new Date();
    const rows = yield* dbQuery(() =>
      db
        .insert(prdRoundPageDesign)
        .values({ roundId: round.id, pageId: page.id, placementSpec: trimmed, distilledAt })
        .onConflictDoUpdate({
          target: [prdRoundPageDesign.roundId, prdRoundPageDesign.pageId],
          set: { placementSpec: trimmed, distilledAt },
        })
        .returning(),
    );
    return rows[0]!;
  });

/** Verdict of the `prd ready` design-lock gate (PRD 0028). */
export type DesignReadiness = { blocked: boolean; reasons: string[] };

/**
 * Decide whether a PRD revision's prototype exploration has converged enough to
 * leave authoring (the `prd ready` design-lock gate, PRD 0028 / 0030). A
 * revision with no (non-archived) prototype is never blocked. Otherwise it
 * blocks a page when:
 *
 * 1. it offers a genuine, **undecided** choice — **≥ 2 variants on the pinned
 *    version and no elected design** (the issue-01 rule); or
 * 2. it is **decided** (elected, OR a single-variant page retained by default)
 *    but has **no distilled placement** for the current `(round, page)` in
 *    `prd_round_page_design` (PRD 0030 / issue 02). This is the safety net: the
 *    placement is normally authored on the fly when the page is decided, and the
 *    gate only *catches* a decided page nobody distilled, pointing at it.
 *
 * A single-variant page is **retained by default**: there is nothing to choose,
 * so it is treated as decided. The relevant variant count is the count on the
 * version the current round pins for that page (the manifest's `pageVersionId`)
 * — the design actually shipping. Defensively, a prototype with no round at all
 * falls back to the page's total variant count across versions, applying the
 * same "≥ 2 without election blocks, ≤ 1 is decided" rule; with no round there
 * is no `(round, page)` placement to require, so a decided page is not blocked
 * on a missing placement in that legacy path.
 *
 * The gate is scoped to the current round's manifest (PRD 0029 / C): only the
 * pages the current round still ships are evaluated, so a page dropped from
 * the current round no longer blocks `ready`. A prototype with no round at
 * all (defensive — `createPrototype` always seeds one) falls back to evaluating
 * every page.
 *
 * Reads the tree directly rather than taking a gathered state — the gate runs
 * once, on a small dataset, and keeping the read here avoids threading the whole
 * tree through the CLI.
 */
export const evaluateDesignReadiness = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prototypes = yield* dbQuery(() =>
      db.query.prdPrototypes.findMany({ where: { prdRevisionId } }),
    );
    const reasons: string[] = [];
    for (const proto of prototypes) {
      if (proto.archivedAt) continue;
      const pages = yield* dbQuery(() =>
        db.query.prdPrototypePages.findMany({ where: { prototypeId: proto.id } }),
      );
      // Only the current round's manifest counts toward the gate: a page
      // dropped from the current round is intentionally out of this round and
      // must not block. `manifest === null` keeps the legacy "all pages"
      // behaviour when the prototype has no round at all. The election is read
      // from the manifest row, not the page (PRD 0030 — round-scoped election).
      const current = yield* getCurrentRound(proto.id);
      const manifest = current
        ? new Map((yield* listRoundPages(current.id)).map((entry) => [entry.pageId, entry]))
        : null;
      // Pages that already carry a distilled placement in the current round,
      // looked up in one pass so the per-page check stays a cheap set membership.
      const distilledPageIds = current
        ? new Set(
            (yield* dbQuery(() =>
              db.query.prdRoundPageDesign.findMany({ where: { roundId: current.id } }),
            )).map((row) => row.pageId),
          )
        : new Set<string>();
      for (const page of pages) {
        const entry = manifest?.get(page.id) ?? null;
        if (manifest && !entry) continue;
        // The chosen design comes from the round's manifest row when the page is
        // in a round; with no round at all we fall back to the page-level column.
        const chosenVariantId = manifest ? (entry?.chosenVariantId ?? null) : page.chosenVariantId;
        // The relevant variant count is the count on the version the current
        // round pins for this page; with no round we fall back to the page's
        // total variant count across versions.
        const pinnedVersionId = entry?.pageVersionId ?? null;
        let variantCount = 0;
        if (pinnedVersionId !== null) {
          const variants = yield* dbQuery(() =>
            db.query.prdPrototypeVariants.findMany({ where: { pageVersionId: pinnedVersionId } }),
          );
          variantCount = variants.length;
        } else {
          const versions = yield* dbQuery(() =>
            db.query.prdPrototypePageVersions.findMany({ where: { pageId: page.id } }),
          );
          for (const version of versions) {
            const variants = yield* dbQuery(() =>
              db.query.prdPrototypeVariants.findMany({ where: { pageVersionId: version.id } }),
            );
            variantCount += variants.length;
          }
        }
        // Undecided: a genuine ≥ 2-variant choice with no election (issue 01).
        if (!chosenVariantId && variantCount >= 2) {
          reasons.push(
            `prototype '${proto.slug}' page '${page.slug}' has ${variantCount} variant(s) but no elected design`,
          );
          continue;
        }
        // Decided (elected, or a mono-variant page retained by default) but not
        // distilled in the current round: the safety net catches it (issue 02).
        // The legacy no-round path has no `(round, page)` placement to require.
        if (manifest && !distilledPageIds.has(page.id)) {
          reasons.push(
            `prototype '${proto.slug}' page '${page.slug}' is decided but has no distilled placement in the current round (run \`depot prd prototype distill ${page.id}\`)`,
          );
        }
      }
    }
    return { blocked: reasons.length > 0, reasons } satisfies DesignReadiness;
  });

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Outcome of resolving a `data-depot-page="<slug>"` link. The link target may
 * be a page the resolved round no longer ships (dropped from the manifest):
 * that is a legitimate, expected state — the round simply doesn't contain the
 * page — so it is a discriminated outcome, not an error. A broken link (slug
 * with no matching page at all) stays an error.
 */
export type ResolveVariantOutcome =
  | {
      kind: "resolved";
      page: PrdPrototypePageRow;
      version: PrdPrototypePageVersionRow;
      variant: PrdPrototypeVariantRow;
    }
  | { kind: "dropped"; page: PrdPrototypePageRow };

/**
 * Resolve a `data-depot-page="<slug>"` link inside a variant's HTML, relative to
 * a round. The round is `input.roundId` if given, otherwise the prototype's
 * current (mutable) round. Within that round the page is pinned to a specific
 * version by the manifest, and the variant is the page's `is_main` variant
 * (`variantLabel = null`) or the named one.
 *
 * A page present in the prototype but absent from the round manifest resolves
 * to `{ kind: "dropped" }` — the round dropped it, that is not an error. As a
 * defensive back-compat path, a prototype with no round at all falls back to
 * the legacy "latest non-archived version" resolution and reports `resolved`.
 */
export const resolveVariant = (input: {
  prototypeId: string;
  pageSlug: string;
  variantLabel?: string | null;
  roundId?: string | null;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const proto = yield* getPrototype(input.prototypeId);

    const page = yield* dbQuery(() =>
      db.query.prdPrototypePages.findFirst({
        where: { prototypeId: proto.id, slug: input.pageSlug },
      }),
    );
    if (!page) {
      return yield* Effect.fail(
        new PrototypePageNotFoundInPrototypeError({
          prototypeId: proto.id,
          slug: input.pageSlug,
        }),
      );
    }

    const round = input.roundId ? yield* getRound(input.roundId) : yield* getCurrentRound(proto.id);

    const wantedLabel = input.variantLabel ?? null;

    const resolveVariantOnVersion = (version: PrdPrototypePageVersionRow) =>
      Effect.gen(function* () {
        if (wantedLabel === null) {
          const mainVariant = yield* dbQuery(() =>
            db.query.prdPrototypeVariants.findFirst({
              where: { pageVersionId: version.id, isMain: true },
            }),
          );
          if (!mainVariant) {
            return yield* Effect.fail(
              new PrototypeVariantNotFoundError({
                id: `(no main variant on version ${version.id})`,
              }),
            );
          }
          return mainVariant;
        }
        const variant = yield* dbQuery(() =>
          db.query.prdPrototypeVariants.findFirst({
            where: { pageVersionId: version.id, label: wantedLabel },
          }),
        );
        if (!variant) {
          return yield* Effect.fail(
            new PrototypeVariantNotFoundError({
              id: `(${input.pageSlug}/${version.label}/${wantedLabel})`,
            }),
          );
        }
        return variant;
      });

    // Defensive legacy fallback: a prototype with no round at all resolves
    // against the page's latest non-archived version, preserving pre-round
    // behaviour.
    if (!round) {
      const latestVersion = yield* getLatestActiveVersionForPage(page.id);
      if (!latestVersion) {
        return yield* Effect.fail(
          new PrototypeVersionNotFoundError({ id: `(no active version on page ${page.id})` }),
        );
      }
      const variant = yield* resolveVariantOnVersion(latestVersion);
      return {
        kind: "resolved",
        page,
        version: latestVersion,
        variant,
      } satisfies ResolveVariantOutcome;
    }

    const entry = yield* dbQuery(() =>
      db.query.prdPrototypeRoundPages.findFirst({
        where: { roundId: round.id, pageId: page.id },
      }),
    );
    if (!entry) {
      return { kind: "dropped", page } satisfies ResolveVariantOutcome;
    }

    const version = yield* getVersion(entry.pageVersionId);
    const variant = yield* resolveVariantOnVersion(version);
    return { kind: "resolved", page, version, variant } satisfies ResolveVariantOutcome;
  });

// ── Feedback ─────────────────────────────────────────────────────────────────

/**
 * Add a feedback against a variant. Refuses (`FeedbackOnStaleVersionError`,
 * mapped to HTTP 409) when the variant's page version is no longer the
 * latest non-archived version of its page — silently accepting it would mean
 * the feedback sits in a dead pile the agent never reads on the next pass.
 */
export const addFeedback = (input: {
  variantId: string;
  text: string;
  selectorCss?: string | null;
}) =>
  Effect.gen(function* () {
    if (input.text.trim().length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: "feedback text must not be empty" }));
    }
    const db = yield* Db;
    const variant = yield* getVariant(input.variantId);
    const version = yield* getVersion(variant.pageVersionId);
    const latest = yield* getLatestActiveVersionForPage(version.pageId);
    if (!latest || latest.id !== version.id) {
      return yield* Effect.fail(
        new FeedbackOnStaleVersionError({
          variantId: variant.id,
          pageId: version.pageId,
          staleVersionId: version.id,
          latestVersionId: latest?.id ?? "(none)",
        }),
      );
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypeFeedback)
        .values({
          id: generateId(),
          variantId: input.variantId,
          text: input.text,
          selectorCss: input.selectorCss ?? null,
          status: "open" as FeedbackStatus,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const getFeedback = (feedbackId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypeFeedback.findFirst({ where: { id: feedbackId } }),
    );
    if (!row) return yield* Effect.fail(new FeedbackNotFoundError({ id: feedbackId }));
    return row;
  });

/**
 * Annotate a feedback as resolved by the agent. `status` stays `open` — see
 * the module header: "addressed" is *derived* from the version graph, not
 * stored. The `resolution_*` columns let the agent record what they did
 * (note + via-variant pointer) for the audit log.
 */
export const resolveFeedback = (
  feedbackId: string,
  options: { note?: string | null; viaVariantId?: string | null } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* getFeedback(feedbackId);

    if (options.viaVariantId) {
      // Soft-validate the via-variant exists so the audit log is meaningful.
      yield* getVariant(options.viaVariantId);
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prdPrototypeFeedback)
        .set({
          resolutionNote: options.note ?? null,
          resolutionViaVariantId: options.viaVariantId ?? null,
          resolvedAt: new Date(),
        })
        .where(eq(prdPrototypeFeedback.id, feedbackId))
        .returning(),
    );
    return rows[0]!;
  });

/**
 * Hard-delete a feedback. Only permitted when the feedback's target variant
 * sits on the latest non-archived version of its page — the same staleness
 * guard as `addFeedback`. Deleting from a stale version would silently rewrite
 * history the agent has already processed; mutating that timeline is what
 * `ignoreFeedback` is for. Returns the deleted row so the caller can echo it
 * for confirmation / activity logging.
 */
export const deleteFeedback = (feedbackId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const fb = yield* getFeedback(feedbackId);
    const variant = yield* getVariant(fb.variantId);
    const version = yield* getVersion(variant.pageVersionId);
    const latest = yield* getLatestActiveVersionForPage(version.pageId);
    if (!latest || latest.id !== version.id) {
      return yield* Effect.fail(
        new FeedbackOnStaleVersionError({
          variantId: variant.id,
          pageId: version.pageId,
          staleVersionId: version.id,
          latestVersionId: latest?.id ?? "(none)",
        }),
      );
    }
    yield* dbQuery(() =>
      db.delete(prdPrototypeFeedback).where(eq(prdPrototypeFeedback.id, feedbackId)),
    );
    return fb;
  });

/**
 * Flip a feedback to `ignored`. `reason` is mandatory (non-empty after trim);
 * an ignored feedback without a stated reason poisons the audit log so the
 * command refuses rather than accept a silent dismissal.
 */
export const ignoreFeedback = (feedbackId: string, options: { reason: string }) =>
  Effect.gen(function* () {
    const trimmed = options.reason?.trim() ?? "";
    if (trimmed.length === 0) {
      return yield* Effect.fail(
        new ValidationError({
          reason: "ignore reason must not be empty — every ignored feedback needs a documented why",
        }),
      );
    }
    const db = yield* Db;
    yield* getFeedback(feedbackId);

    const rows = yield* dbQuery(() =>
      db
        .update(prdPrototypeFeedback)
        .set({
          status: "ignored" as FeedbackStatus,
          ignoredReason: trimmed,
          ignoredAt: new Date(),
        })
        .where(eq(prdPrototypeFeedback.id, feedbackId))
        .returning(),
    );
    return rows[0]!;
  });

/**
 * List feedbacks for every prototype attached to a revision, optionally
 * filtered by `status` or a single `variantId`. The result is sorted oldest
 * → newest so the agent walks the timeline in order.
 */
export const listFeedbacks = (
  prdRevisionId: string,
  filters: { status?: FeedbackStatus; variantId?: string } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const protos = yield* dbQuery(() =>
      db.query.prdPrototypes.findMany({
        where: { prdRevisionId },
        columns: { id: true },
      }),
    );
    if (protos.length === 0) return [];
    const protoIds = protos.map((p) => p.id);
    const pages = yield* dbQuery(() =>
      db.query.prdPrototypePages.findMany({
        where: { prototypeId: { in: protoIds } },
        columns: { id: true },
      }),
    );
    if (pages.length === 0) return [];
    const versions = yield* dbQuery(() =>
      db.query.prdPrototypePageVersions.findMany({
        where: { pageId: { in: pages.map((p) => p.id) } },
        columns: { id: true },
      }),
    );
    if (versions.length === 0) return [];
    const variants = yield* dbQuery(() =>
      db.query.prdPrototypeVariants.findMany({
        where: { pageVersionId: { in: versions.map((v) => v.id) } },
        columns: { id: true },
      }),
    );
    if (variants.length === 0) return [];

    const variantIds = filters.variantId
      ? variants.filter((v) => v.id === filters.variantId).map((v) => v.id)
      : variants.map((v) => v.id);
    if (variantIds.length === 0) return [];

    const rows = yield* dbQuery(() =>
      db.query.prdPrototypeFeedback.findMany({
        where: {
          variantId: { in: variantIds },
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: { createdAt: "asc" },
      }),
    );
    return rows;
  });

/**
 * Load the entire prototype tree for rendering (web UI + renderer marker).
 * Returns shape `{ prototype, pages: [{ page, versions: [{ version, variants,
 * feedbacks }] }] }`. Feedbacks are grouped per variant so the renderer can
 * compute the "addressed" derived bucket without re-walking the graph.
 */
export const loadPrototypeTree = (prototypeId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const proto = yield* getPrototype(prototypeId);

    const pages = yield* dbQuery(() =>
      db.query.prdPrototypePages.findMany({
        where: { prototypeId: proto.id },
        orderBy: { position: "asc", createdAt: "asc" },
      }),
    );

    const tree: Array<{
      page: PrdPrototypePageRow;
      versions: Array<{
        version: PrdPrototypePageVersionRow;
        variants: PrdPrototypeVariantRow[];
        feedbacks: PrdPrototypeFeedbackRow[];
      }>;
    }> = [];

    for (const page of pages) {
      const versions = yield* dbQuery(() =>
        db.query.prdPrototypePageVersions.findMany({
          where: { pageId: page.id },
          orderBy: { createdAt: "asc" },
        }),
      );
      const versionEntries: Array<{
        version: PrdPrototypePageVersionRow;
        variants: PrdPrototypeVariantRow[];
        feedbacks: PrdPrototypeFeedbackRow[];
      }> = [];
      for (const version of versions) {
        const variants = yield* dbQuery(() =>
          db.query.prdPrototypeVariants.findMany({
            where: { pageVersionId: version.id },
            orderBy: { position: "asc", createdAt: "asc" },
          }),
        );
        const feedbacks =
          variants.length === 0
            ? []
            : yield* dbQuery(() =>
                db.query.prdPrototypeFeedback.findMany({
                  where: { variantId: { in: variants.map((v) => v.id) } },
                  orderBy: { createdAt: "asc" },
                }),
              );
        versionEntries.push({ version, variants, feedbacks });
      }
      tree.push({ page, versions: versionEntries });
    }

    // Expose the rounds additively: each round with its manifest, so
    // view models can show which page versions a given round ships. Rounds by
    // position, manifest entries by position — same ordering the domain uses.
    const roundRows = yield* listRounds(proto.id);
    const rounds: Array<{
      round: PrdPrototypeRoundRow;
      pages: PrdPrototypeRoundPageRow[];
    }> = [];
    for (const round of roundRows) {
      const manifest = yield* listRoundPages(round.id);
      rounds.push({ round, pages: manifest });
    }

    return { prototype: proto, pages: tree, rounds };
  });

// ── Rounds (PRD 0029 / Tranche A) ─────────────────────────────────────────────
//
// A round is a whole-design round: a named, manifest-pinned snapshot of which
// page version ships together (distinct from a per-page `version`). The manifest
// is the set of `prd_prototype_round_pages` rows — membership is row presence,
// so a page absent from the manifest is simply not in the round. The current
// round is the one with the maximum `position`; it is the only mutable one,
// earlier rounds are frozen by construction.

export const createRound = (input: {
  prototypeId: string;
  label: string;
  summary?: string | null;
  fromRoundId?: string | null;
}) =>
  Effect.gen(function* () {
    yield* validateSlug(input.label, "round label");
    const db = yield* Db;
    yield* getPrototype(input.prototypeId);

    const existing = yield* dbQuery(() =>
      db.query.prdPrototypeRounds.findFirst({
        where: { prototypeId: input.prototypeId, label: input.label },
      }),
    );
    if (existing) {
      return yield* Effect.fail(
        new PrototypeRoundLabelExistsError({
          prototypeId: input.prototypeId,
          label: input.label,
        }),
      );
    }

    const siblings = yield* dbQuery(() =>
      db.query.prdPrototypeRounds.findMany({
        where: { prototypeId: input.prototypeId },
        columns: { position: true },
      }),
    );
    const nextPosition =
      siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.position)) + 1;

    const newRoundId = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypeRounds)
        .values({
          id: newRoundId,
          prototypeId: input.prototypeId,
          label: input.label,
          summary: input.summary ?? null,
          position: nextPosition,
        })
        .returning(),
    );

    if (input.fromRoundId) {
      const source = yield* getRound(input.fromRoundId);
      const sourcePages = yield* dbQuery(() =>
        db.query.prdPrototypeRoundPages.findMany({
          where: { roundId: source.id },
        }),
      );
      // Clone the manifest only — never create a new page_version. The clone
      // pins the exact same versions the source round pinned, and inherits each
      // page's election (PRD 0030): re-opening a round carries the decision
      // forward; it is reset only when the page's pinned version later advances.
      for (const sp of sourcePages) {
        yield* dbQuery(() =>
          db.insert(prdPrototypeRoundPages).values({
            id: generateId(),
            roundId: newRoundId,
            pageId: sp.pageId,
            pageVersionId: sp.pageVersionId,
            position: sp.position,
            chosenVariantId: sp.chosenVariantId,
            decisionRationale: sp.decisionRationale,
            decidedBy: sp.decidedBy,
            decidedAt: sp.decidedAt,
          }),
        );
      }
      // Inherit each page's distilled placement too (PRD 0030 / issue 02), on
      // the same rule as the election: the clone pins the same versions, so the
      // placement is still valid and carries forward. It is reset only when the
      // page's pinned version later advances (the placement was about the old
      // variant).
      const sourcePlacements = yield* dbQuery(() =>
        db.query.prdRoundPageDesign.findMany({ where: { roundId: source.id } }),
      );
      for (const placement of sourcePlacements) {
        yield* dbQuery(() =>
          db.insert(prdRoundPageDesign).values({
            roundId: newRoundId,
            pageId: placement.pageId,
            placementSpec: placement.placementSpec,
            distilledAt: placement.distilledAt,
          }),
        );
      }
    }

    return rows[0]!;
  });

export const listRounds = (prototypeId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPrototypeRounds.findMany({
        where: { prototypeId },
        orderBy: { position: "asc", createdAt: "asc" },
      }),
    );
  });

export const getRound = (roundId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPrototypeRounds.findFirst({ where: { id: roundId } }),
    );
    if (!row) return yield* Effect.fail(new PrototypeRoundNotFoundError({ id: roundId }));
    return row;
  });

/**
 * The current round of a prototype is the one with the maximum `position`
 * (tie-broken by `createdAt`/`id` so the result is deterministic). It is the
 * only mutable round. Returns `null` when the prototype has no round.
 */
export const getCurrentRound = (prototypeId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rows = yield* dbQuery(() =>
      db
        .select()
        .from(prdPrototypeRounds)
        .where(eq(prdPrototypeRounds.prototypeId, prototypeId))
        .orderBy(
          desc(prdPrototypeRounds.position),
          desc(prdPrototypeRounds.createdAt),
          desc(prdPrototypeRounds.id),
        )
        .limit(1),
    );
    return rows[0] ?? null;
  });

export const listRoundPages = (roundId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPrototypeRoundPages.findMany({
        where: { roundId },
        orderBy: { position: "asc", createdAt: "asc" },
      }),
    );
  });

/**
 * Upsert a page into a round's manifest. With `pageVersionId` omitted, pins
 * the page's latest active version. If the page is already in the manifest, its
 * pin is updated in place (the unique `(round, page)` index forbids a
 * duplicate row). Idempotent.
 */
export const includePage = (roundId: string, pageId: string, pageVersionId?: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const round = yield* getRound(roundId);
    yield* getPage(pageId);

    let pinId = pageVersionId ?? null;
    if (pinId === null) {
      const latest = yield* getLatestActiveVersionForPage(pageId);
      if (!latest) {
        return yield* Effect.fail(
          new PrototypeVersionNotFoundError({ id: `(no active version on page ${pageId})` }),
        );
      }
      pinId = latest.id;
    } else {
      const version = yield* getVersion(pinId);
      if (version.pageId !== pageId) {
        return yield* Effect.fail(
          new ValidationError({
            reason: `version ${pinId} does not belong to page ${pageId}`,
          }),
        );
      }
    }

    const existing = yield* dbQuery(() =>
      db.query.prdPrototypeRoundPages.findFirst({
        where: { roundId: round.id, pageId },
      }),
    );
    if (existing) {
      // Advancing the pin to a *different* version resets the election AND the
      // distilled placement (PRD 0030): both decisions were about the old
      // variant, so a fresh pin must not inherit a stale choice or a stale
      // placement. Re-pinning the same version leaves them untouched (idempotent).
      const advanced = existing.pageVersionId !== pinId;
      const updated = yield* dbQuery(() =>
        db
          .update(prdPrototypeRoundPages)
          .set(
            advanced
              ? {
                  pageVersionId: pinId,
                  chosenVariantId: null,
                  decisionRationale: null,
                  decidedBy: null,
                  decidedAt: null,
                }
              : { pageVersionId: pinId },
          )
          .where(eq(prdPrototypeRoundPages.id, existing.id))
          .returning(),
      );
      if (advanced) {
        yield* dbQuery(() =>
          db
            .delete(prdRoundPageDesign)
            .where(
              and(eq(prdRoundPageDesign.roundId, round.id), eq(prdRoundPageDesign.pageId, pageId)),
            ),
        );
      }
      return updated[0]!;
    }

    const siblings = yield* dbQuery(() =>
      db.query.prdPrototypeRoundPages.findMany({
        where: { roundId: round.id },
        columns: { position: true },
      }),
    );
    const nextPosition =
      siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.position)) + 1;

    const rows = yield* dbQuery(() =>
      db
        .insert(prdPrototypeRoundPages)
        .values({
          id: generateId(),
          roundId: round.id,
          pageId,
          pageVersionId: pinId,
          position: nextPosition,
        })
        .returning(),
    );
    return rows[0]!;
  });

/**
 * Pin a specific version of a page into a round's manifest. Like
 * `includePage` but the version is required and validated to belong to the
 * page — pinning a version from a different page is a `ValidationError`.
 */
export const pinPage = (roundId: string, pageId: string, pageVersionId: string) =>
  Effect.gen(function* () {
    const version = yield* getVersion(pageVersionId);
    if (version.pageId !== pageId) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `version ${pageVersionId} does not belong to page ${pageId}`,
        }),
      );
    }
    return yield* includePage(roundId, pageId, pageVersionId);
  });

/** Remove a page from a round's manifest. No-op when the page is absent. */
export const dropPage = (roundId: string, pageId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* dbQuery(() =>
      db
        .delete(prdRoundPageDesign)
        .where(and(eq(prdRoundPageDesign.roundId, roundId), eq(prdRoundPageDesign.pageId, pageId))),
    );
    yield* dbQuery(() =>
      db
        .delete(prdPrototypeRoundPages)
        .where(
          and(
            eq(prdPrototypeRoundPages.roundId, roundId),
            eq(prdPrototypeRoundPages.pageId, pageId),
          ),
        ),
    );
  });

// ── Fork helper ──────────────────────────────────────────────────────────────

/**
 * Duplicate every prototype (and its pages / versions / variants / feedbacks)
 * attached to `sourcePrdRevisionId` onto `targetPrdRevisionId`, generating
 * fresh IDs and remapping FKs. Called by `forkPrd` so a forked revision keeps
 * a self-contained prototype snapshot (cohérent with the annexes recopy
 * pattern from PRD 0024).
 */
export const forkPrototypes = (sourcePrdRevisionId: string, targetPrdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const sourceProtos = yield* dbQuery(() =>
      db.query.prdPrototypes.findMany({
        where: { prdRevisionId: sourcePrdRevisionId },
      }),
    );
    // Accumulate the old → new page id remapping across every prototype so the
    // caller (`forkPrd`) can rebuild the `task_prototype_pages` links onto the
    // fork's own pages (PRD 0030 / issue 04).
    const pageIdMapAll = new Map<string, string>();
    for (const sp of sourceProtos) {
      const newProtoId = generateId();
      yield* dbQuery(() =>
        db.insert(prdPrototypes).values({
          id: newProtoId,
          prdRevisionId: targetPrdRevisionId,
          slug: sp.slug,
          description: sp.description,
          archivedAt: sp.archivedAt,
        }),
      );
      // Track id remappings across the whole tree so round manifests (which
      // reference pages, versions, and the elected variant) can be rebuilt with
      // the fork's ids.
      const pageIdMap = new Map<string, string>();
      const versionIdMap = new Map<string, string>();
      const variantIdMapAll = new Map<string, string>();
      const sourcePages = yield* dbQuery(() =>
        db.query.prdPrototypePages.findMany({ where: { prototypeId: sp.id } }),
      );
      for (const page of sourcePages) {
        const newPageId = generateId();
        pageIdMap.set(page.id, newPageId);
        pageIdMapAll.set(page.id, newPageId);
        yield* dbQuery(() =>
          db.insert(prdPrototypePages).values({
            id: newPageId,
            prototypeId: newProtoId,
            slug: page.slug,
            title: page.title,
            position: page.position,
          }),
        );
        const sourceVersions = yield* dbQuery(() =>
          db.query.prdPrototypePageVersions.findMany({ where: { pageId: page.id } }),
        );
        for (const v of sourceVersions) {
          const newVersionId = generateId();
          versionIdMap.set(v.id, newVersionId);
          yield* dbQuery(() =>
            db.insert(prdPrototypePageVersions).values({
              id: newVersionId,
              pageId: newPageId,
              label: v.label,
              summary: v.summary,
              archivedAt: v.archivedAt,
            }),
          );
          const sourceVariants = yield* dbQuery(() =>
            db.query.prdPrototypeVariants.findMany({ where: { pageVersionId: v.id } }),
          );
          const variantIdMap = new Map<string, string>();
          for (const variant of sourceVariants) {
            const newVariantId = generateId();
            variantIdMap.set(variant.id, newVariantId);
            variantIdMapAll.set(variant.id, newVariantId);
            yield* dbQuery(() =>
              db.insert(prdPrototypeVariants).values({
                id: newVariantId,
                pageVersionId: newVersionId,
                label: variant.label,
                title: variant.title,
                htmlContent: variant.htmlContent,
                isMain: variant.isMain,
                position: variant.position,
              }),
            );
          }
          const sourceFeedbacks = yield* dbQuery(() =>
            db.query.prdPrototypeFeedback.findMany({
              where: { variantId: { in: sourceVariants.map((vv) => vv.id) } },
            }),
          );
          for (const fb of sourceFeedbacks) {
            const newId = generateId();
            const remappedVia = fb.resolutionViaVariantId
              ? (variantIdMap.get(fb.resolutionViaVariantId) ?? null)
              : null;
            yield* dbQuery(() =>
              db.insert(prdPrototypeFeedback).values({
                id: newId,
                variantId: variantIdMap.get(fb.variantId)!,
                text: fb.text,
                selectorCss: fb.selectorCss,
                status: fb.status,
                resolutionNote: fb.resolutionNote,
                resolutionViaVariantId: remappedVia,
                resolvedAt: fb.resolvedAt,
                ignoredReason: fb.ignoredReason,
                ignoredAt: fb.ignoredAt,
              }),
            );
          }
        }
      }

      // Recreate the source prototype's rounds and their manifests on the
      // fork. The fork does its inserts directly (no `createPrototype`), so no
      // parasitic `v1` round exists yet — these are the only rounds. Pins
      // are remapped to the fork's pages/versions via the maps built above.
      const sourceRounds = yield* listRounds(sp.id);
      for (const round of sourceRounds) {
        const newRoundId = generateId();
        yield* dbQuery(() =>
          db.insert(prdPrototypeRounds).values({
            id: newRoundId,
            prototypeId: newProtoId,
            label: round.label,
            summary: round.summary,
            position: round.position,
          }),
        );
        const manifest = yield* listRoundPages(round.id);
        for (const entry of manifest) {
          yield* dbQuery(() =>
            db.insert(prdPrototypeRoundPages).values({
              id: generateId(),
              roundId: newRoundId,
              pageId: pageIdMap.get(entry.pageId)!,
              pageVersionId: versionIdMap.get(entry.pageVersionId)!,
              position: entry.position,
              // Carry the round-scoped election, remapping the elected variant
              // id to the fork's own variant (PRD 0030).
              chosenVariantId: entry.chosenVariantId
                ? (variantIdMapAll.get(entry.chosenVariantId) ?? null)
                : null,
              decisionRationale: entry.decisionRationale,
              decidedBy: entry.decidedBy,
              decidedAt: entry.decidedAt,
            }),
          );
        }
        // Carry each `(round, page)` distilled placement onto the fork,
        // remapping the page id (PRD 0030 / issue 02). The placement text and
        // its `distilledAt` are preserved verbatim — the fork keeps the
        // validated layout the source already authored.
        const placements = yield* dbQuery(() =>
          db.query.prdRoundPageDesign.findMany({ where: { roundId: round.id } }),
        );
        for (const placement of placements) {
          yield* dbQuery(() =>
            db.insert(prdRoundPageDesign).values({
              roundId: newRoundId,
              pageId: pageIdMap.get(placement.pageId)!,
              placementSpec: placement.placementSpec,
              distilledAt: placement.distilledAt,
            }),
          );
        }
      }
    }
    return pageIdMapAll;
  });

export type {
  PrdPrototypeRow,
  PrdPrototypePageRow,
  PrdPrototypePageVersionRow,
  PrdPrototypeVariantRow,
  PrdPrototypeFeedbackRow,
  PrdPrototypeRoundRow,
  PrdPrototypeRoundPageRow,
  PrdRoundPageDesignRow,
};
