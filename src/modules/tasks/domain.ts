import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { tasks } from "#/db/schema";
import { generateId } from "#/shared/utils";
import { normalizeTaskDescriptionForStorage } from "#/modules/tasks/spec";
import {
  VALID_TASK_TRANSITIONS,
  type TaskStatus,
  type Effort,
  type SeverityLevel,
} from "#/shared/validator";
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
  prdRevisionId: string;
  title: string;
  description: string;
  doneCriteria: string;
  effort: Effort;
  dependsOn?: string[];
  phaseNumber?: number;
}) =>
  Effect.gen(function* () {
    if (!input.doneCriteria || input.doneCriteria.trim() === "") {
      return yield* Effect.fail(
        new ValidationError({ reason: "Task must have non-empty done_criteria" }),
      );
    }

    const db = yield* Db;

    const existing = yield* dbQuery(() =>
      db.query.tasks.findMany({ where: { prdRevisionId: input.prdRevisionId } }),
    );
    const nextPosition = existing.length + 1;
    const storedDescription = normalizeTaskDescriptionForStorage(input.description);

    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(tasks)
        .values({
          id,
          prdRevisionId: input.prdRevisionId,
          position: nextPosition,
          title: input.title,
          description: storedDescription.description,
          descriptionFormat: storedDescription.descriptionFormat,
          doneCriteria: input.doneCriteria,
          dependsOn: JSON.stringify(input.dependsOn ?? []),
          effort: input.effort,
          phaseNumber: input.phaseNumber ?? null,
          status: "pending",
          blockedReason: null,
          skipReason: null,
          startedAt: null,
          completedAt: null,
        })
        .returning(),
    );
    const task = rows[0]!;
    const prd = yield* getPrd(task.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: task.id,
        eventType: "task_created",
        payload: { taskId: task.id, title: task.title, kind: "prd" },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return task;
  });

export const updateTask = (
  id: string,
  changes: {
    title?: string;
    description?: string;
    doneCriteria?: string;
    effort?: Effort;
    phaseNumber?: number | null;
    dependsOn?: string[];
    addDependsOn?: string[];
    removeDependsOn?: string[];
    severity?: SeverityLevel | null;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));

    const fields = [
      changes.title !== undefined ? "title" : null,
      changes.description !== undefined ? "description" : null,
      changes.doneCriteria !== undefined ? "doneCriteria" : null,
      changes.effort !== undefined ? "effort" : null,
      changes.phaseNumber !== undefined ? "phaseNumber" : null,
      changes.dependsOn !== undefined ||
      changes.addDependsOn !== undefined ||
      changes.removeDependsOn !== undefined
        ? "dependsOn"
        : null,
      changes.severity !== undefined ? "severity" : null,
    ].filter((field): field is string => field !== null);

    if (fields.length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: "No task changes provided" }));
    }

    if (changes.doneCriteria !== undefined && changes.doneCriteria.trim() === "") {
      return yield* Effect.fail(
        new ValidationError({ reason: "Task must have non-empty done_criteria" }),
      );
    }

    if (changes.severity !== undefined && changes.severity !== null && !task.reviewId) {
      return yield* Effect.fail(
        new ValidationError({
          reason: "Severity can only be set on review tasks (tasks with a reviewId).",
        }),
      );
    }

    let nextDependsOn: string | undefined;
    if (
      changes.dependsOn !== undefined ||
      changes.addDependsOn !== undefined ||
      changes.removeDependsOn !== undefined
    ) {
      let resolved: string[];
      if (changes.dependsOn !== undefined) {
        resolved = [...changes.dependsOn];
      } else {
        resolved = JSON.parse(task.dependsOn) as string[];
        if (changes.addDependsOn) {
          for (const depId of changes.addDependsOn) {
            if (!resolved.includes(depId)) resolved.push(depId);
          }
        }
        if (changes.removeDependsOn) {
          const toRemove = new Set(changes.removeDependsOn);
          resolved = resolved.filter((d) => !toRemove.has(d));
        }
      }

      for (const depId of resolved) {
        if (depId === id) {
          return yield* Effect.fail(
            new ValidationError({ reason: "A task cannot depend on itself." }),
          );
        }
        const dep = yield* getTask(depId);
        if (!dep) return yield* Effect.fail(new TaskNotFoundError({ id: depId }));
      }
      nextDependsOn = JSON.stringify(resolved);
    }

    const storedDescription =
      changes.description !== undefined
        ? normalizeTaskDescriptionForStorage(changes.description)
        : null;

    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({
          title: changes.title ?? task.title,
          description: storedDescription?.description ?? task.description,
          descriptionFormat: storedDescription?.descriptionFormat ?? task.descriptionFormat,
          doneCriteria: changes.doneCriteria ?? task.doneCriteria,
          effort: changes.effort ?? task.effort,
          phaseNumber: changes.phaseNumber !== undefined ? changes.phaseNumber : task.phaseNumber,
          dependsOn: nextDependsOn ?? task.dependsOn,
          severity: changes.severity !== undefined ? changes.severity : task.severity,
        })
        .where(eq(tasks.id, id))
        .returning(),
    );

    const updated = rows[0]!;
    const prd = yield* getPrd(updated.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: updated.id,
        eventType: "task_updated",
        payload: {
          taskId: updated.id,
          title: updated.title,
          fields,
          kind: updated.reviewId ? "review" : "prd",
        },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    return updated;
  });

export const getTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.tasks.findFirst({ where: { id } }));
    return row ?? null;
  });

export const listTasks = (
  prdRevisionId: string,
  options: { prdTasksOnly?: boolean; phase?: number | null } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    let rows: (typeof tasks.$inferSelect)[];
    if (options.prdTasksOnly) {
      rows = yield* dbQuery(() =>
        db.query.tasks.findMany({
          where: { prdRevisionId, reviewId: { isNull: true } },
          orderBy: { position: "asc" },
        }),
      );
    } else {
      rows = yield* dbQuery(() =>
        db.query.tasks.findMany({ where: { prdRevisionId }, orderBy: { position: "asc" } }),
      );
    }
    if (options.phase !== undefined && options.phase !== null) {
      rows = rows.filter((t) => t.phaseNumber === options.phase);
    }
    return rows;
  });

export const startTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    yield* checkTaskTransition(task.status, "in_progress");

    // Phase gate: a base task (not a review finding) on a multi-phase PRD
    // cannot start ahead of the PRD's currentPhase. Audit findings (reviewId
    // set) are part of the current phase's review loop and aren't gated by
    // phase-advance — they're free to run regardless.
    const prd = yield* getPrd(task.prdRevisionId);
    if (
      prd &&
      task.reviewId === null &&
      task.phaseNumber !== null &&
      prd.currentPhase !== null &&
      task.phaseNumber > prd.currentPhase
    ) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot start task '${task.title}' (${task.id}): it is in phase ${task.phaseNumber} but the PRD is on phase ${prd.currentPhase}. Open the review gate (depot prd request-review ${prd.id}) and advance (depot prd phase-advance ${prd.id}) first.`,
        }),
      );
    }

    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({ status: "in_progress", startedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning(),
    );
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
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
    const prd = yield* getPrd(task.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
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
    const prd = yield* getPrd(task.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: id,
        eventType: "task_blocked",
        payload: { taskId: task.id, title: task.title, reason },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });

export const deleteTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    if (task.status !== "pending") {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot delete task: status is '${task.status}', only 'pending' is allowed.`,
        }),
      );
    }
    const prd = yield* getPrd(task.prdRevisionId);
    yield* dbQuery(() => db.delete(tasks).where(eq(tasks.id, id)));
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        eventType: "task_deleted",
        payload: { taskId: id, title: task.title },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return task;
  });

export const reactivateTask = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));
    if (task.status !== "skipped") {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot reactivate task: status is '${task.status}', expected 'skipped'.`,
        }),
      );
    }
    const rows = yield* dbQuery(() =>
      db
        .update(tasks)
        .set({ status: "pending", skipReason: null, completedAt: null })
        .where(eq(tasks.id, id))
        .returning(),
    );
    const prd = yield* getPrd(task.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: id,
        eventType: "task_reactivated",
        payload: {
          taskId: id,
          title: task.title,
          previousSkipReason: task.skipReason ?? null,
        },
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
    const prd = yield* getPrd(task.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: id,
        eventType: "task_skipped",
        payload: { taskId: task.id, title: task.title, reason },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });
