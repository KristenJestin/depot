import { Effect } from "effect";
import { and, desc, eq } from "drizzle-orm";
import {
  ideas,
  prds,
  prdRevisions,
  prdIdeas,
  prdTags,
  type IdeaRow,
  type PrdIdeaRow,
} from "#/db/schema";
import { Db } from "#/services/database";
import { dbQuery } from "#/shared/db";
import { generateId } from "#/shared/utils";
import {
  CrossEntityError,
  DatabaseError,
  IdeaNotFoundError,
  IdeaNotOpenError,
  InvalidTransitionError,
  PrdNotFoundError,
  ValidationError,
} from "#/shared/errors";
import {
  IDEA_BODY_MAX_BYTES,
  IDEA_TITLE_MAX_LENGTH,
  VALID_IDEA_TRANSITIONS,
  invalidTagReason,
  type IdeaStatus,
} from "#/shared/validator";

/**
 * Idea-capture domain (PRD 0027 / T1).
 *
 * A thin, project-scoped entity that sits *before* the commitment a PRD
 * represents. CRUD + a triage lifecycle (`open → promoted | dropped`,
 * `dropped → open`) plus the single bridge into the committed world,
 * `promoteIdea`, which spins up a draft PRD seeded from the idea and links
 * them. Activity logging is intentionally NOT done here — it lives at the CLI
 * layer, on the same model as the prototype module.
 *
 * Two relations to PRDs, never collapsed:
 *  - `idea.promotedPrdId` — provenance, set once by `promote`, points at the
 *    *logical* PRD so it survives forks.
 *  - `prd_ideas` (M:N) — source material, attached to the logical PRD like
 *    tags/dependencies. Linking does NOT change `idea.status`.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const validateTitle = (title: string) =>
  Effect.gen(function* () {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: "idea title must not be empty" }));
    }
    if (trimmed.length > IDEA_TITLE_MAX_LENGTH) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `idea title must be at most ${IDEA_TITLE_MAX_LENGTH} characters (got ${trimmed.length})`,
        }),
      );
    }
  });

const validateTag = (tag: string) =>
  Effect.gen(function* () {
    const reason = invalidTagReason(tag);
    if (reason !== null) {
      return yield* Effect.fail(new ValidationError({ reason }));
    }
  });

const validateBody = (body: string) =>
  Effect.gen(function* () {
    const bytes = Buffer.byteLength(body, "utf-8");
    if (bytes > IDEA_BODY_MAX_BYTES) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `idea body is ${bytes} bytes, exceeding the ${IDEA_BODY_MAX_BYTES}-byte (100 KB) cap`,
        }),
      );
    }
  });

const checkIdeaTransition = (from: IdeaStatus, to: IdeaStatus) => {
  const allowed = VALID_IDEA_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return Effect.fail(
      new InvalidTransitionError({ entity: "idea", from, to, allowed: [...allowed] }),
    );
  }
  return Effect.succeed(undefined);
};

/** Resolve a logical PRD id from either a logical PRD id or one of its revision ids. */
const resolveLogicalPrdId = (prdRef: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const logical = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: prdRef } }));
    if (logical) return logical;
    const rev = yield* dbQuery(() => db.query.prdRevisions.findFirst({ where: { id: prdRef } }));
    if (rev) {
      const byRev = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: rev.prdId } }));
      if (byRev) return byRev;
    }
    return yield* Effect.fail(new PrdNotFoundError({ id: prdRef }));
  });

// ── Ideas ─────────────────────────────────────────────────────────────────────

export const createIdea = (input: {
  projectId: string;
  title: string;
  body?: string | null;
  tag?: string | null;
}) =>
  Effect.gen(function* () {
    yield* validateTitle(input.title);
    if (input.tag != null) yield* validateTag(input.tag);
    if (input.body != null) yield* validateBody(input.body);
    const db = yield* Db;

    const rows = yield* dbQuery(() =>
      db
        .insert(ideas)
        .values({
          id: generateId(),
          projectId: input.projectId,
          title: input.title.trim(),
          body: input.body ?? null,
          tag: input.tag ?? null,
          status: "open",
          promotedPrdId: null,
          droppedReason: null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listIdeas = (projectId: string, filter: { status?: IdeaStatus; tag?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const status = filter.status ?? "open";
    return yield* dbQuery(() =>
      db.query.ideas.findMany({
        where: {
          projectId,
          status,
          ...(filter.tag !== undefined ? { tag: filter.tag } : {}),
        },
        orderBy: { createdAt: "desc", id: "desc" },
      }),
    );
  });

export const getIdea = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.ideas.findFirst({ where: { id } }));
    if (!row) return yield* Effect.fail(new IdeaNotFoundError({ id }));
    return row;
  });

export const updateIdea = (
  id: string,
  changes: { title?: string; body?: string | null; tag?: string | null },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const idea = yield* getIdea(id);

    if (changes.title !== undefined) yield* validateTitle(changes.title);
    if (changes.tag != null) yield* validateTag(changes.tag);
    if (changes.body != null) yield* validateBody(changes.body);

    const rows = yield* dbQuery(() =>
      db
        .update(ideas)
        .set({
          title: changes.title !== undefined ? changes.title.trim() : idea.title,
          body: changes.body !== undefined ? changes.body : idea.body,
          tag: changes.tag !== undefined ? changes.tag : idea.tag,
        })
        .where(eq(ideas.id, id))
        .returning(),
    );
    return rows[0]!;
  });

export const dropIdea = (id: string, options: { reason?: string | null } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const idea = yield* getIdea(id);
    yield* checkIdeaTransition(idea.status, "dropped");
    const rows = yield* dbQuery(() =>
      db
        .update(ideas)
        .set({ status: "dropped", droppedReason: options.reason ?? null })
        .where(eq(ideas.id, id))
        .returning(),
    );
    return rows[0]!;
  });

export const reopenIdea = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const idea = yield* getIdea(id);
    yield* checkIdeaTransition(idea.status, "open");
    const rows = yield* dbQuery(() =>
      db
        .update(ideas)
        .set({ status: "open", droppedReason: null })
        .where(eq(ideas.id, id))
        .returning(),
    );
    return rows[0]!;
  });

// ── Promote ─────────────────────────────────────────────────────────────────

/**
 * Promote an open idea into a draft PRD — the single bridge into the committed
 * world. Guarded `status === "open"` (else `IdeaNotOpenError`). In one
 * transaction: create the logical PRD + its first draft revision (title ←
 * override ?? idea.title, context ← idea.body); carry the idea's tag onto the
 * new PRD if set; flip the idea to `promoted` with `promotedPrdId` = the
 * *logical* PRD id; and insert a `prd_ideas` row so the new PRD lists its
 * originating idea as source material. Returns `{ idea, prd }` where `prd` is
 * the freshly-created draft *revision* row (its `.prdId` is the logical id).
 */
export const promoteIdea = (id: string, options: { title?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const idea = yield* getIdea(id);
    if (idea.status !== "open") {
      return yield* Effect.fail(new IdeaNotOpenError({ id, status: idea.status }));
    }

    const title = options.title ?? idea.title;
    yield* validateTitle(title);

    const result = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          const prdId = generateId();
          const revId = generateId();

          tx.insert(prds)
            .values({
              id: prdId,
              projectId: idea.projectId,
              currentRevisionId: revId,
            })
            .run();

          const revRows = tx
            .insert(prdRevisions)
            .values({
              id: revId,
              prdId,
              projectId: idea.projectId,
              workspaceId: null,
              revision: 1,
              title: title.trim(),
              context: idea.body ?? null,
              scope: null,
              status: "draft",
              readyAt: null,
              activatedAt: null,
            })
            .returning()
            .all();
          const rev = revRows[0]!;

          if (idea.tag) {
            tx.insert(prdTags).values({ prdId, tag: idea.tag }).run();
          }

          const ideaRows = tx
            .update(ideas)
            .set({ status: "promoted", promotedPrdId: prdId })
            .where(eq(ideas.id, id))
            .returning()
            .all();

          tx.insert(prdIdeas).values({ prdId, ideaId: id }).run();

          return { idea: ideaRows[0]!, prd: rev };
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });
    return result;
  });

// ── PRD ↔ idea reference join ──────────────────────────────────────────────────

/**
 * Link a source idea to a PRD (idempotent). Validates both exist and belong to
 * the same project. Accepts a logical PRD id or any of its revision ids. Does
 * NOT change `idea.status` — referencing ≠ committing.
 */
export const linkIdeaToPrd = (prdRef: string, ideaId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const idea = yield* getIdea(ideaId);
    const prd = yield* resolveLogicalPrdId(prdRef);
    if (prd.projectId !== idea.projectId) {
      return yield* Effect.fail(
        new CrossEntityError({
          reason: `Idea '${ideaId}' (project '${idea.projectId}') and PRD '${prd.id}' (project '${prd.projectId}') belong to different projects`,
        }),
      );
    }

    const existing = yield* dbQuery(() =>
      db.query.prdIdeas.findFirst({ where: { prdId: prd.id, ideaId } }),
    );
    if (existing) return existing;

    const rows = yield* dbQuery(() =>
      db.insert(prdIdeas).values({ prdId: prd.id, ideaId }).returning(),
    );
    return rows[0]!;
  });

/**
 * Unlink a source idea from a PRD (idempotent no-op when absent). Does NOT
 * change `idea.status`.
 */
export const unlinkIdeaFromPrd = (prdRef: string, ideaId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* resolveLogicalPrdId(prdRef);
    yield* dbQuery(() =>
      db.delete(prdIdeas).where(and(eq(prdIdeas.prdId, prd.id), eq(prdIdeas.ideaId, ideaId))),
    );
    return { prdId: prd.id, ideaId };
  });

/** List the source ideas linked to a PRD, newest-first. */
export const listPrdIdeas = (prdRef: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* resolveLogicalPrdId(prdRef);
    const links = yield* dbQuery(() =>
      db.query.prdIdeas.findMany({
        where: { prdId: prd.id },
        orderBy: { createdAt: "desc" },
      }),
    );
    if (links.length === 0) return [] as IdeaRow[];
    const ideaIds = links.map((l) => l.ideaId);
    const rows = yield* dbQuery(() =>
      db.query.ideas.findMany({
        where: { id: { in: ideaIds } },
      }),
    );
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    return links.map((l) => byId.get(l.ideaId)).filter((r): r is IdeaRow => r !== undefined);
  });

/**
 * List the head-revision rows of every PRD that references `ideaId` as source
 * material. Returns the current revision for each linked logical PRD.
 */
export const listIdeaPrds = (ideaId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    yield* getIdea(ideaId);
    const links = yield* dbQuery(() =>
      db.query.prdIdeas.findMany({
        where: { ideaId },
        orderBy: { createdAt: "desc" },
      }),
    );
    if (links.length === 0) return [];
    return yield* dbQuery(() =>
      db
        .select()
        .from(prdRevisions)
        .innerJoin(prds, eq(prds.currentRevisionId, prdRevisions.id))
        .innerJoin(prdIdeas, eq(prdIdeas.prdId, prds.id))
        .where(eq(prdIdeas.ideaId, ideaId))
        .orderBy(desc(prdIdeas.createdAt))
        .then((rows) => rows.map((r) => r.prd_revisions)),
    );
  });

export type { IdeaRow, PrdIdeaRow };
