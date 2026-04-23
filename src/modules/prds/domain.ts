import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { prds } from "#/db/schema";
import { generateId } from "#/shared/utils";
import { VALID_PRD_TRANSITIONS, type PrdStatus } from "#/shared/validator";
import { Db } from "#/services/database";
import {
  PrdNotFoundError,
  WorkspaceAlreadyHasActivePrdError,
  InvalidTransitionError,
} from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { logActivity } from "#/modules/activity/domain";

// ── Internal helpers ──────────────────────────────────────────────────────────

const checkPrdTransition = (from: PrdStatus, to: PrdStatus) => {
  const allowed = VALID_PRD_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return Effect.fail(
      new InvalidTransitionError({ entity: "PRD", from, to, allowed: [...allowed] }),
    );
  }
  return Effect.succeed(undefined);
};

// ── Functions ─────────────────────────────────────────────────────────────────

export const createPrd = (input: {
  projectId: string;
  title: string;
  context?: string;
  scope?: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(prds)
        .values({
          id,
          projectId: input.projectId,
          workspaceId: null,
          parentId: null,
          revision: 1,
          title: input.title,
          context: input.context ?? null,
          scope: input.scope ?? null,
          status: "draft",
          readyAt: null,
          activatedAt: null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const getPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.prds.findFirst({ where: { id } }));
    return row ?? null;
  });

export const listPrds = (filter: { projectId?: string; workspaceId?: string } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    if (filter.workspaceId) {
      return yield* dbQuery(() =>
        db.query.prds.findMany({
          where: { workspaceId: filter.workspaceId },
          orderBy: { createdAt: "asc" },
        }),
      );
    }
    if (filter.projectId) {
      return yield* dbQuery(() =>
        db.query.prds.findMany({
          where: { projectId: filter.projectId },
          orderBy: { createdAt: "asc" },
        }),
      );
    }
    return yield* dbQuery(() => db.query.prds.findMany({ orderBy: { createdAt: "asc" } }));
  });

export const activatePrd = (id: string, workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* getPrd(id);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id }));

    const activePrd = yield* dbQuery(() =>
      db.query.prds.findFirst({ where: { workspaceId, status: "in_progress" } }),
    );
    if (activePrd && activePrd.id !== id) {
      return yield* Effect.fail(
        new WorkspaceAlreadyHasActivePrdError({ workspaceId, activePrdId: activePrd.id }),
      );
    }

    yield* checkPrdTransition(prd.status, "in_progress");

    const rows = yield* dbQuery(() =>
      db
        .update(prds)
        .set({ status: "in_progress", workspaceId, activatedAt: new Date() })
        .where(eq(prds.id, id))
        .returning(),
    );

    yield* logActivity({
      projectId: prd.projectId,
      workspaceId,
      prdId: id,
      eventType: "prd_activated",
      payload: { title: prd.title },
    });

    return rows[0]!;
  });

export const markPrdReady = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* getPrd(id);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(prd.status, "ready");
    const rows = yield* dbQuery(() =>
      db
        .update(prds)
        .set({ status: "ready", readyAt: new Date() })
        .where(eq(prds.id, id))
        .returning(),
    );
    yield* logActivity({
      projectId: prd.projectId,
      prdId: id,
      eventType: "prd_ready",
      payload: { title: prd.title },
    });
    return rows[0]!;
  });

export const donePrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* getPrd(id);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(prd.status, "done");
    const rows = yield* dbQuery(() =>
      db.update(prds).set({ status: "done" }).where(eq(prds.id, id)).returning(),
    );
    yield* logActivity({
      projectId: prd.projectId,
      workspaceId: prd.workspaceId ?? undefined,
      prdId: id,
      eventType: "prd_done",
      payload: { title: prd.title },
    });
    return rows[0]!;
  });

export const cancelPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* getPrd(id);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(prd.status, "canceled");
    const rows = yield* dbQuery(() =>
      db.update(prds).set({ status: "canceled" }).where(eq(prds.id, id)).returning(),
    );
    yield* logActivity({
      projectId: prd.projectId,
      workspaceId: prd.workspaceId ?? undefined,
      prdId: id,
      eventType: "prd_canceled",
      payload: { title: prd.title },
    });
    return rows[0]!;
  });
