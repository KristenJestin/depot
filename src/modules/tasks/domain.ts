import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { tasks } from "#/db/schema";
import { generateId } from "#/shared/utils";
import { normalizeTaskDescriptionForStorage } from "#/modules/tasks/spec";
import { VALID_TASK_TRANSITIONS, type TaskStatus, type Effort } from "#/shared/validator";
import { Db } from "#/services/database";
import {
  TaskNotFoundError,
  DependencyNotDoneError,
  InvalidTransitionError,
  ValidationError,
} from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { logActivity } from "#/modules/activity/domain";
import { getPrd } from "#/modules/prds/domain";

// ── Internal helpers ──────────────────────────────────────────────────────────

const checkTaskTransition = (from: TaskStatus, to: TaskStatus) => {
  const allowed = VALID_TASK_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return Effect.fail(
      new InvalidTransitionError({ entity: "task", from, to, allowed: [...allowed] }),
    );
  }
  return Effect.succeed(undefined);
};

// ── Functions ─────────────────────────────────────────────────────────────────

export const createTask = (input: {
  prdId: string;
  title: string;
  description: string;
  doneCriteria: string;
  effort: Effort;
  dependsOn?: string[];
}) =>
  Effect.gen(function* () {
    if (!input.doneCriteria || input.doneCriteria.trim() === "") {
      return yield* Effect.fail(
        new ValidationError({ reason: "Task must have non-empty done_criteria" }),
      );
    }

    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.tasks.findMany({ where: { prdId: input.prdId } }),
    );
    const nextPosition = existing.length + 1;
    const storedDescription = normalizeTaskDescriptionForStorage(input.description);

    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(tasks)
        .values({
          id,
          prdId: input.prdId,
          position: nextPosition,
          title: input.title,
          description: storedDescription.description,
          descriptionFormat: storedDescription.descriptionFormat,
          doneCriteria: input.doneCriteria,
          dependsOn: JSON.stringify(input.dependsOn ?? []),
          effort: input.effort,
          status: "pending",
          blockedReason: null,
          skipReason: null,
          startedAt: null,
          completedAt: null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const getTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.tasks.findFirst({ where: { id } }));
    return row ?? null;
  });

export const listTasks = (prdId: string, options: { prdTasksOnly?: boolean } = {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    if (options.prdTasksOnly) {
      return yield* dbQuery(() =>
        db.query.tasks.findMany({
          where: { prdId, reviewId: { isNull: true } },
          orderBy: { position: "asc" },
        }),
      );
    }
    return yield* dbQuery(() =>
      db.query.tasks.findMany({ where: { prdId }, orderBy: { position: "asc" } }),
    );
  });

export const startTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    yield* checkTaskTransition(task.status, "in_progress");
    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({ status: "in_progress", startedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning(),
    );
    const prd = yield* getPrd(task.prdId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdId: prd.id,
        taskId: id,
        eventType: "task_started",
        payload: { taskId: task.id, title: task.title },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });

export const completeTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    yield* checkTaskTransition(task.status, "done");

    if (!task.startedAt) {
      return yield* Effect.fail(
        new ValidationError({ reason: "Cannot complete task: started_at is not set" }),
      );
    }

    const deps: string[] = JSON.parse(task.dependsOn);
    for (const depId of deps) {
      const dep = yield* getTask(depId);
      if (!dep) return yield* Effect.fail(new TaskNotFoundError({ id: depId }));
      if (dep.status !== "done" && dep.status !== "skipped") {
        return yield* Effect.fail(
          new DependencyNotDoneError({ taskId: id, depId, depStatus: dep.status }),
        );
      }
    }

    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning(),
    );
    const prd = yield* getPrd(task.prdId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdId: prd.id,
        taskId: id,
        eventType: "task_done",
        payload: { taskId: task.id, title: task.title },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });

export const blockTask = (id: string, reason: string) =>
  Effect.gen(function* () {
    if (!reason || reason.trim() === "") {
      return yield* Effect.fail(new ValidationError({ reason: "Block reason is required" }));
    }
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    yield* checkTaskTransition(task.status, "blocked");
    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({ status: "blocked", blockedReason: reason })
        .where(eq(tasks.id, id))
        .returning(),
    );
    const prd = yield* getPrd(task.prdId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdId: prd.id,
        taskId: id,
        eventType: "task_blocked",
        payload: { taskId: task.id, title: task.title, reason },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });

export const skipTask = (id: string, reason: string) =>
  Effect.gen(function* () {
    if (!reason || reason.trim() === "") {
      return yield* Effect.fail(new ValidationError({ reason: "Skip reason is required" }));
    }
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    yield* checkTaskTransition(task.status, "skipped");
    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({ status: "skipped", skipReason: reason, completedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning(),
    );
    const prd = yield* getPrd(task.prdId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdId: prd.id,
        taskId: id,
        eventType: "task_skipped",
        payload: { taskId: task.id, title: task.title, reason },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });
