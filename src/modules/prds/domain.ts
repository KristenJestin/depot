import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { prds, tasks } from "#/db/schema";
import { generateId } from "#/shared/utils";
import { normalizeTaskDescriptionForStorage } from "#/modules/tasks/spec";
import { VALID_PRD_TRANSITIONS, type PrdStatus, type Effort } from "#/shared/validator";
import { Db } from "#/services/database";
import {
  PrdNotFoundError,
  PrdNotDraftError,
  WorkspaceAlreadyHasActivePrdError,
  InvalidTransitionError,
  DatabaseError,
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
          rootId: id, // v1 points to itself
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

export const listPrds = (
  filter: { projectId?: string; workspaceId?: string; latestOnly?: boolean } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    let rows: (typeof prds.$inferSelect)[];
    if (filter.workspaceId) {
      rows = yield* dbQuery(() =>
        db.query.prds.findMany({
          where: { workspaceId: filter.workspaceId },
          orderBy: { createdAt: "asc" },
        }),
      );
    } else if (filter.projectId) {
      rows = yield* dbQuery(() =>
        db.query.prds.findMany({
          where: { projectId: filter.projectId },
          orderBy: { createdAt: "asc" },
        }),
      );
    } else {
      rows = yield* dbQuery(() => db.query.prds.findMany({ orderBy: { createdAt: "asc" } }));
    }

    if (filter.latestOnly) {
      // Exclude PRDs that are a parent of another PRD (i.e., keep only leaf revisions)
      const parentIds = new Set(rows.filter((p) => p.parentId !== null).map((p) => p.parentId!));
      rows = rows.filter((p) => !parentIds.has(p.id));
    }

    return rows;
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
      payload: { prdId: id, title: prd.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

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
      payload: { prdId: id, title: prd.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
      payload: { prdId: id, title: prd.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
      payload: { prdId: id, title: prd.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

export const forkPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prd = yield* getPrd(id);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id }));
    if (prd.status !== "ready") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          entity: "PRD",
          from: prd.status,
          to: "draft (fork)",
          allowed: ["ready"],
        }),
      );
    }
    const newId = generateId();
    const rootId = prd.rootId ?? prd.id;
    const rows = yield* dbQuery(() =>
      db
        .insert(prds)
        .values({
          id: newId,
          projectId: prd.projectId,
          workspaceId: null,
          rootId,
          parentId: prd.id,
          revision: prd.revision + 1,
          title: prd.title,
          context: prd.context,
          scope: prd.scope,
          status: "draft",
          readyAt: null,
          activatedAt: null,
        })
        .returning(),
    );
    const newPrd = rows[0]!;

    const sourceTasks = yield* dbQuery(() =>
      db.query.tasks.findMany({ where: { prdId: prd.id }, orderBy: { position: "asc" } }),
    );

    const idMap = new Map<string, string>();
    for (const task of sourceTasks) {
      idMap.set(task.id, generateId());
    }

    for (const task of sourceTasks) {
      const newTaskId = idMap.get(task.id)!;
      const remappedDeps = (JSON.parse(task.dependsOn ?? "[]") as string[]).map(
        (oldId) => idMap.get(oldId) ?? oldId,
      );
      yield* dbQuery(() =>
        db.insert(tasks).values({
          ...task,
          id: newTaskId,
          prdId: newId,
          status: "pending",
          blockedReason: null,
          skipReason: null,
          startedAt: null,
          completedAt: null,
          dependsOn: JSON.stringify(remappedDeps),
        }),
      );
    }

    yield* logActivity({
      projectId: prd.projectId,
      prdId: newPrd.id,
      eventType: "prd_forked",
      payload: { sourcePrdId: prd.id, newPrdId: newPrd.id, revision: newPrd.revision },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return newPrd;
  });

export const listPrdFamily = (rootId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prds.findMany({
        where: { rootId },
        orderBy: { revision: "asc" },
      }),
    );
  });

export type ReloadPrdBatchInput = {
  prdId: string;
  title: string;
  context?: string;
  scope?: string;
  tasks: BatchTaskInput[];
};

/**
 * Replace the content of a draft PRD in a single atomic transaction.
 * ID, createdAt, rootId, parentId, revision, and workspaceId are preserved.
 * Only draft PRDs can be reloaded.
 */
export const reloadPrdBatch = (input: ReloadPrdBatchInput) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const prd = yield* getPrd(input.prdId);
    if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id: input.prdId }));
    if (prd.status !== "draft") {
      return yield* Effect.fail(new PrdNotDraftError({ id: input.prdId, status: prd.status }));
    }

    const result = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          tx.update(prds)
            .set({ title: input.title, context: input.context ?? null, scope: input.scope ?? null })
            .where(eq(prds.id, input.prdId))
            .run();

          tx.delete(tasks).where(eq(tasks.prdId, input.prdId)).run();

          const createdTaskIds: string[] = [];
          const createdTasks: (typeof tasks.$inferSelect)[] = [];

          for (let i = 0; i < input.tasks.length; i++) {
            const taskInput = input.tasks[i]!;
            const resolvedDeps = (taskInput.dependsOn ?? []).map((idx) => {
              const resolved = createdTaskIds[idx];
              if (resolved === undefined) {
                throw new Error(
                  `Task at index ${i} has invalid dependsOn index ${idx}: task ID not yet created (forward reference or out-of-range)`,
                );
              }
              return resolved;
            });
            const storedDescription = normalizeTaskDescriptionForStorage(taskInput.description);
            const taskId = generateId();
            const position = i + 1;

            const taskRows = tx
              .insert(tasks)
              .values({
                id: taskId,
                prdId: input.prdId,
                position,
                title: taskInput.title,
                description: storedDescription.description,
                descriptionFormat: storedDescription.descriptionFormat,
                doneCriteria: taskInput.doneCriteria,
                dependsOn: JSON.stringify(resolvedDeps),
                effort: taskInput.effort,
                status: "pending",
                blockedReason: null,
                skipReason: null,
                startedAt: null,
                completedAt: null,
              })
              .returning()
              .all();

            const task = taskRows[0]!;
            createdTaskIds.push(task.id);
            createdTasks.push(task);
          }

          const updatedPrd = tx.select().from(prds).where(eq(prds.id, input.prdId)).all()[0]!;
          return { prd: updatedPrd, tasks: createdTasks };
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });

    return result;
  });

export type BatchTaskInput = {
  title: string;
  description: string;
  doneCriteria: string;
  effort: Effort;
  dependsOn?: readonly number[] | number[];
};

export type LoadPrdBatchInput = {
  projectId: string;
  title: string;
  context?: string;
  scope?: string;
  ready?: boolean;
  tasks: BatchTaskInput[];
};

/**
 * Atomically create a PRD with all its tasks in a single SQLite transaction.
 * If any step fails, the entire batch is rolled back — no partial state is committed.
 */
export const loadPrdBatch = (input: LoadPrdBatchInput) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const result = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          const prdId = generateId();
          const prdRows = tx
            .insert(prds)
            .values({
              id: prdId,
              projectId: input.projectId,
              workspaceId: null,
              rootId: prdId,
              parentId: null,
              revision: 1,
              title: input.title,
              context: input.context ?? null,
              scope: input.scope ?? null,
              status: "draft",
              readyAt: null,
              activatedAt: null,
            })
            .returning()
            .all();

          const prd = prdRows[0]!;

          const createdTaskIds: string[] = [];
          const createdTasks: (typeof tasks.$inferSelect)[] = [];

          for (let i = 0; i < input.tasks.length; i++) {
            const taskInput = input.tasks[i]!;
            const resolvedDeps = (taskInput.dependsOn ?? []).map((idx) => {
              const resolved = createdTaskIds[idx];
              if (resolved === undefined) {
                throw new Error(
                  `Task at index ${i} has invalid dependsOn index ${idx}: task ID not yet created (forward reference or out-of-range)`,
                );
              }
              return resolved;
            });
            const storedDescription = normalizeTaskDescriptionForStorage(taskInput.description);
            const taskId = generateId();
            const position = i + 1;

            const taskRows = tx
              .insert(tasks)
              .values({
                id: taskId,
                prdId: prdId,
                position,
                title: taskInput.title,
                description: storedDescription.description,
                descriptionFormat: storedDescription.descriptionFormat,
                doneCriteria: taskInput.doneCriteria,
                dependsOn: JSON.stringify(resolvedDeps),
                effort: taskInput.effort,
                status: "pending",
                blockedReason: null,
                skipReason: null,
                startedAt: null,
                completedAt: null,
              })
              .returning()
              .all();

            const task = taskRows[0]!;
            createdTaskIds.push(task.id);
            createdTasks.push(task);
          }

          let finalPrd = prd;
          if (input.ready) {
            const updatedRows = tx
              .update(prds)
              .set({ status: "ready", readyAt: new Date() })
              .where(eq(prds.id, prdId))
              .returning()
              .all();
            finalPrd = updatedRows[0]!;
          }

          return { prd: finalPrd, tasks: createdTasks };
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });

    return result;
  });
