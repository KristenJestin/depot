import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { prds, prdRevisions, prdPhaseSnapshots, prdMerges, tasks } from "#/db/schema";
import type { PrdMergeRow } from "#/db/schema";
import { generateId } from "#/shared/utils";
import { normalizeTaskDescriptionForStorage } from "#/modules/tasks/spec";
import {
  VALID_PRD_TRANSITIONS,
  type PrdStatus,
  type Effort,
  type MergeCaptureSource,
} from "#/shared/validator";
import { Db } from "#/services/database";
import {
  PrdNotFoundError,
  PrdNotDraftError,
  WorkspaceAlreadyHasActivePrdError,
  InvalidTransitionError,
  DatabaseError,
  ValidationError,
  ShaNotFoundError,
} from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { logActivity } from "#/modules/activity/domain";
import { assertWorkspaceInProject } from "#/lib/cross-entity";
import { captureSha } from "#/lib/git";
import { assertShaExists } from "#/lib/repo-guard";
import { resolveProjectRepos } from "#/modules/projects/repos";

/**
 * Capture a single HEAD SHA for a PRD lifecycle transition.
 *
 * For a mono-repo project (no `project_repo` rows) this resolves the implicit
 * repo and captures its HEAD — unchanged behaviour, zero config. For a
 * multi-repo project a single blind HEAD capture would record a SHA from
 * whichever repo `workspacePath` happens to sit in, so we skip and defer the
 * per-repo capture to `capture-merge`.
 */
const captureLifecycleSha = (projectId: string, workspacePath: string) =>
  Effect.gen(function* () {
    const repos = yield* resolveProjectRepos(projectId, workspacePath).pipe(
      Effect.catchAll(() => Effect.succeed([])),
    );
    if (repos.length === 1 && repos[0]!.implicit) {
      return yield* captureSha(repos[0]!.path);
    }
    return null;
  });

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

/**
 * Create a new PRD (logical entity + initial revision r1).
 * Returns the revision row — callers always work with revision IDs.
 */
export const createPrd = (input: {
  projectId: string;
  title: string;
  context?: string;
  scope?: string;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const prdId = generateId();
    const revId = generateId();

    yield* dbQuery(() =>
      db.insert(prds).values({
        id: prdId,
        projectId: input.projectId,
        currentRevisionId: revId,
      }),
    );

    const revRows = yield* dbQuery(() =>
      db
        .insert(prdRevisions)
        .values({
          id: revId,
          prdId,
          projectId: input.projectId,
          workspaceId: null,
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
    const rev = revRows[0]!;

    yield* logActivity({
      projectId: rev.projectId,
      prdRevisionId: rev.id,
      eventType: "prd_created",
      payload: { prdRevisionId: rev.id, prdId, title: rev.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    return rev;
  });

export const updatePrd = (
  id: string,
  changes: {
    title?: string;
    context?: string | null;
    scope?: string | null;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    if (rev.status !== "draft") {
      return yield* Effect.fail(new PrdNotDraftError({ id, status: rev.status }));
    }

    const fields = [
      changes.title !== undefined ? "title" : null,
      changes.context !== undefined ? "context" : null,
      changes.scope !== undefined ? "scope" : null,
    ].filter((field): field is string => field !== null);

    if (fields.length === 0) {
      return yield* Effect.fail(new DatabaseError({ cause: new Error("No PRD changes provided") }));
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({
          title: changes.title ?? rev.title,
          context: changes.context !== undefined ? changes.context : rev.context,
          scope: changes.scope !== undefined ? changes.scope : rev.scope,
        })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );

    const updated = rows[0]!;
    yield* logActivity({
      projectId: updated.projectId,
      workspaceId: updated.workspaceId ?? undefined,
      prdRevisionId: updated.id,
      eventType: "prd_updated",
      payload: { prdRevisionId: updated.id, title: updated.title, fields },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return updated;
  });

/** Look up a PRD by its revision ID. */
export const getPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.prdRevisions.findFirst({ where: { id } }));
    return row ?? null;
  });

export const listPrds = (
  filter: { projectId?: string; workspaceId?: string; latestOnly?: boolean } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    let rows: (typeof prdRevisions.$inferSelect)[];
    if (filter.workspaceId) {
      rows = yield* dbQuery(() =>
        db.query.prdRevisions.findMany({
          where: { workspaceId: filter.workspaceId },
          orderBy: { createdAt: "asc" },
        }),
      );
    } else if (filter.projectId) {
      rows = yield* dbQuery(() =>
        db.query.prdRevisions.findMany({
          where: { projectId: filter.projectId },
          orderBy: { createdAt: "asc" },
        }),
      );
    } else {
      rows = yield* dbQuery(() =>
        db.query.prdRevisions.findMany({ orderBy: { createdAt: "asc" } }),
      );
    }

    if (filter.latestOnly) {
      // Keep only the current revision for each logical PRD (the one pointed to by prds.currentRevisionId)
      const prdRows = yield* dbQuery(() => db.query.prds.findMany());
      const currentRevIds = new Set(
        prdRows.map((p) => p.currentRevisionId).filter((id): id is string => id !== null),
      );
      rows = rows.filter((r) => currentRevIds.has(r.id));
    }

    return rows;
  });

export const activatePrd = (id: string, workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));

    // Refuse to attach a PRD to a workspace from a different project — this
    // is the silent-corruption path that previously slipped through and got
    // detected only when callers later tried to write activity_log rows.
    const workspace = yield* assertWorkspaceInProject(workspaceId, rev.projectId);

    const activePrd = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { workspaceId, status: "in_progress" } }),
    );
    if (activePrd && activePrd.id !== id) {
      return yield* Effect.fail(
        new WorkspaceAlreadyHasActivePrdError({ workspaceId, activePrdId: activePrd.id }),
      );
    }

    yield* checkPrdTransition(rev.status, "in_progress");

    const sha = yield* captureLifecycleSha(rev.projectId, workspace.path);
    if (!sha) {
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId,
        prdRevisionId: id,
        eventType: "note",
        payload: {
          message: "multi-repo project — per-repo SHA capture deferred to capture-merge",
        },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({
          status: "in_progress",
          workspaceId,
          activatedAt: new Date(),
          ...(sha ? { activatedAtSha: sha } : {}),
        })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );

    yield* logActivity({
      projectId: rev.projectId,
      workspaceId,
      prdRevisionId: id,
      eventType: "prd_activated",
      payload: { prdRevisionId: id, title: rev.title, ...(sha ? { sha } : {}) },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    return rows[0]!;
  });

export const markPrdReady = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(rev.status, "ready");
    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({ status: "ready", readyAt: new Date() })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );
    yield* logActivity({
      projectId: rev.projectId,
      prdRevisionId: id,
      eventType: "prd_ready",
      payload: { prdRevisionId: id, title: rev.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

export const donePrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(rev.status, "done");

    // Capture the done SHA — best-effort; never blocks the transition.
    // Multi-repo projects skip the blind capture (deferred to capture-merge).
    let sha: string | null = null;
    if (rev.workspaceId) {
      const ws = yield* dbQuery(() =>
        db.query.workspaces.findFirst({ where: { id: rev.workspaceId! } }),
      );
      if (ws) {
        sha = yield* captureLifecycleSha(rev.projectId, ws.path);
        if (!sha) {
          yield* logActivity({
            projectId: rev.projectId,
            workspaceId: rev.workspaceId,
            prdRevisionId: id,
            eventType: "note",
            payload: {
              message: "multi-repo project — per-repo SHA capture deferred to capture-merge",
            },
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
        }
      }
    }

    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({ status: "done", ...(sha ? { doneAtSha: sha } : {}) })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );
    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: id,
      eventType: "prd_done",
      payload: { prdRevisionId: id, title: rev.title, ...(sha ? { sha } : {}) },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

export const cancelPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(rev.status, "canceled");
    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({ status: "canceled" })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );
    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: id,
      eventType: "prd_canceled",
      payload: { prdRevisionId: id, title: rev.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

/**
 * Request a human review on an in-progress PRD: transition to `review`.
 * The dev orchestrator calls this at the natural validation gates — end
 * of every audit cycle for multi-phase PRDs and at final close. The
 * kanban surfaces the PRD in the dedicated "Review" column from this
 * point on, marking it explicitly as "blocked by human".
 */
export const requestReviewPrd = (id: string, reason?: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(rev.status, "review");
    const rows = yield* dbQuery(() =>
      db.update(prdRevisions).set({ status: "review" }).where(eq(prdRevisions.id, id)).returning(),
    );
    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: id,
      eventType: "prd_review_requested",
      payload: {
        prdRevisionId: id,
        title: rev.title,
        ...(reason ? { reason } : {}),
      },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

/**
 * Resume work on a PRD that was sitting in `review`: transition back to
 * `in_progress`. The dev orchestrator calls this after the human review
 * Q&A converges and the next coder pass is about to spawn. Equivalent
 * lifecycle to "the human gave actionable feedback, agents pick it up".
 */
export const resumePrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    yield* checkPrdTransition(rev.status, "in_progress");
    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({ status: "in_progress" })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );
    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: id,
      eventType: "prd_resumed",
      payload: { prdRevisionId: id, title: rev.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

/**
 * Fork a ready revision into a new draft revision.
 *
 * Only `ready` revisions can be forked. The new revision is draft, inherits
 * spec fields and clones all PRD tasks. The logical PRD's `currentRevisionId`
 * is updated to point to the new revision, and `supersededAt` is set on the
 * old revision.
 */
export const forkPrd = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    if (rev.status !== "ready") {
      const hint =
        rev.status === "draft"
          ? " The revision is still in 'draft'. Modify it directly with 'depot prd update', 'depot task add', or 'depot task update'. Fork is only needed when a 'ready' revision must be revised."
          : ` Revision status is '${rev.status}'. Forking is not allowed from this status — only 'ready' revisions can be forked.`;
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot fork PRD ${id}: current status is '${rev.status}'. Fork requires a 'ready' revision.${hint}`,
        }),
      );
    }
    const newRevId = generateId();
    const newRevRows = yield* dbQuery(() =>
      db
        .insert(prdRevisions)
        .values({
          id: newRevId,
          prdId: rev.prdId,
          projectId: rev.projectId,
          workspaceId: null,
          revision: rev.revision + 1,
          title: rev.title,
          context: rev.context,
          scope: rev.scope,
          status: "draft",
          currentPhase: rev.currentPhase,
          readyAt: null,
          activatedAt: null,
        })
        .returning(),
    );
    const newRev = newRevRows[0]!;

    // Mark old revision as superseded and update logical PRD pointer
    yield* dbQuery(() =>
      db.update(prdRevisions).set({ supersededAt: new Date() }).where(eq(prdRevisions.id, id)),
    );
    yield* dbQuery(() =>
      db.update(prds).set({ currentRevisionId: newRevId }).where(eq(prds.id, rev.prdId)),
    );

    // Clone PRD tasks into the new revision
    const sourceTasks = yield* dbQuery(() =>
      db.query.tasks.findMany({
        where: { prdRevisionId: rev.id, reviewId: { isNull: true } },
        orderBy: { position: "asc" },
      }),
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
          prdRevisionId: newRevId,
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
      projectId: rev.projectId,
      prdRevisionId: newRev.id,
      eventType: "prd_forked",
      payload: {
        sourcePrdRevisionId: rev.id,
        newPrdRevisionId: newRev.id,
        revision: newRev.revision,
      },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return newRev;
  });

/** List all revisions for the same logical PRD, ordered by revision number. */
export const listPrdFamily = (prdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdRevisions.findMany({
        where: { prdId },
        orderBy: { revision: "asc" },
      }),
    );
  });

export type ReloadPrdBatchInput = {
  prdRevisionId: string;
  title: string;
  context?: string;
  scope?: string;
  tasks: BatchTaskInput[];
};

/**
 * Replace the content of a draft PRD revision in a single atomic transaction.
 * Only draft revisions can be reloaded.
 */
export const reloadPrdBatch = (input: ReloadPrdBatchInput) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const rev = yield* getPrd(input.prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: input.prdRevisionId }));
    if (rev.status !== "draft") {
      return yield* Effect.fail(
        new PrdNotDraftError({ id: input.prdRevisionId, status: rev.status }),
      );
    }

    yield* validatePhaseSequence(input.tasks);

    const result = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          const hasPhases = input.tasks.some(
            (t) => t.phaseNumber !== undefined && t.phaseNumber !== null,
          );
          tx.update(prdRevisions)
            .set({
              title: input.title,
              context: input.context ?? null,
              scope: input.scope ?? null,
              currentPhase: hasPhases ? 1 : null,
            })
            .where(eq(prdRevisions.id, input.prdRevisionId))
            .run();

          tx.delete(tasks).where(eq(tasks.prdRevisionId, input.prdRevisionId)).run();

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
                prdRevisionId: input.prdRevisionId,
                position,
                title: taskInput.title,
                description: storedDescription.description,
                descriptionFormat: storedDescription.descriptionFormat,
                doneCriteria: taskInput.doneCriteria,
                dependsOn: JSON.stringify(resolvedDeps),
                effort: taskInput.effort,
                phaseNumber: taskInput.phaseNumber ?? null,
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

          const updatedRev = tx
            .select()
            .from(prdRevisions)
            .where(eq(prdRevisions.id, input.prdRevisionId))
            .all()[0]!;
          return { prd: updatedRev, tasks: createdTasks };
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });

    // Emit lifecycle events after the transaction commits
    yield* logActivity({
      projectId: result.prd.projectId,
      prdRevisionId: result.prd.id,
      eventType: "prd_updated",
      payload: { prdRevisionId: result.prd.id, title: result.prd.title, fields: ["tasks"] },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    for (const task of result.tasks) {
      yield* logActivity({
        projectId: result.prd.projectId,
        prdRevisionId: result.prd.id,
        eventType: "task_created",
        payload: { taskId: task.id, title: task.title },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    return result;
  });

export type BatchTaskInput = {
  title: string;
  description: string;
  doneCriteria: string;
  effort: Effort;
  dependsOn?: readonly number[] | number[];
  phaseNumber?: number;
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
 * Atomically create a PRD (logical + first revision) with all its tasks.
 * If any step fails, the entire batch is rolled back.
 */
export const loadPrdBatch = (input: LoadPrdBatchInput) =>
  Effect.gen(function* () {
    const db = yield* Db;

    yield* validatePhaseSequence(input.tasks);

    const result = yield* Effect.try({
      try: () =>
        db.transaction((tx) => {
          const prdId = generateId();
          const revId = generateId();
          const hasPhases = input.tasks.some(
            (t) => t.phaseNumber !== undefined && t.phaseNumber !== null,
          );

          tx.insert(prds)
            .values({
              id: prdId,
              projectId: input.projectId,
              currentRevisionId: revId,
            })
            .run();

          const revRows = tx
            .insert(prdRevisions)
            .values({
              id: revId,
              prdId,
              projectId: input.projectId,
              workspaceId: null,
              revision: 1,
              title: input.title,
              context: input.context ?? null,
              scope: input.scope ?? null,
              status: "draft",
              currentPhase: hasPhases ? 1 : null,
              readyAt: null,
              activatedAt: null,
            })
            .returning()
            .all();

          const rev = revRows[0]!;

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
                prdRevisionId: revId,
                position,
                title: taskInput.title,
                description: storedDescription.description,
                descriptionFormat: storedDescription.descriptionFormat,
                doneCriteria: taskInput.doneCriteria,
                dependsOn: JSON.stringify(resolvedDeps),
                effort: taskInput.effort,
                phaseNumber: taskInput.phaseNumber ?? null,
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

          let finalRev = rev;
          if (input.ready) {
            const updatedRows = tx
              .update(prdRevisions)
              .set({ status: "ready", readyAt: new Date() })
              .where(eq(prdRevisions.id, revId))
              .returning()
              .all();
            finalRev = updatedRows[0]!;
          }

          return { prd: finalRev, tasks: createdTasks };
        }),
      catch: (e) => new DatabaseError({ cause: e }),
    });

    // Emit lifecycle events after the transaction commits
    yield* logActivity({
      projectId: result.prd.projectId,
      prdRevisionId: result.prd.id,
      eventType: "prd_created",
      payload: { prdId: result.prd.prdId, title: result.prd.title },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    for (const task of result.tasks) {
      yield* logActivity({
        projectId: result.prd.projectId,
        prdRevisionId: result.prd.id,
        eventType: "task_created",
        payload: { taskId: task.id, title: task.title },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    return result;
  });

// -- Phase advance -------------------------------------------------------------

/**
 * Advance a multi-phase in_progress PRD to its next phase.
 */
export const phaseAdvance = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));

    // Phase advance is the user-approval gate: it must fire from `review`
    // status (the orchestrator opens that gate via `prd request-review` once
    // the current phase's coder + auditor passes are wrapped up). Advancing
    // straight from `in_progress` would skip the human handoff entirely.
    if (rev.status !== "review") {
      const hint =
        rev.status === "in_progress"
          ? ` Open the human-review gate first with: depot prd request-review ${id}`
          : "";
      return yield* Effect.fail(
        new ValidationError({
          reason: `PRD ${id} is not in 'review' (status: '${rev.status}'). Phase advance can only fire after the human-review gate has been opened.${hint}`,
        }),
      );
    }

    if (rev.currentPhase === null || rev.currentPhase === undefined) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `PRD ${id} has no phases defined. Phase advance only applies to multi-phase PRDs.`,
        }),
      );
    }

    const currentPhase = rev.currentPhase;

    const phaseTasks = yield* dbQuery(() =>
      db.query.tasks.findMany({
        where: { prdRevisionId: id, phaseNumber: currentPhase, reviewId: { isNull: true } },
      }),
    );

    const blockedTask = phaseTasks.find((t) => t.status !== "done" && t.status !== "skipped");
    if (blockedTask) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot advance phase: task '${blockedTask.title}' (${blockedTask.id}) in phase ${currentPhase} is still '${blockedTask.status}'. All tasks must be done or skipped first.`,
        }),
      );
    }

    const phaseReviews = yield* dbQuery(() =>
      db.query.reviews.findMany({ where: { prdRevisionId: id, phaseNumber: currentPhase } }),
    );

    const openReview = phaseReviews.find((r) => r.status !== "done");
    if (openReview) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Cannot advance phase: review ${openReview.id} for phase ${currentPhase} is still '${openReview.status}'. All reviews must be done first.`,
        }),
      );
    }

    for (const review of phaseReviews) {
      const reviewTasks = yield* dbQuery(() =>
        db.query.tasks.findMany({ where: { reviewId: review.id } }),
      );
      const openTask = reviewTasks.find((t) => t.status !== "done" && t.status !== "skipped");
      if (openTask) {
        return yield* Effect.fail(
          new ValidationError({
            reason: `Cannot advance phase: review task '${openTask.title}' (${openTask.id}) in review ${review.id} is still '${openTask.status}'.`,
          }),
        );
      }
    }

    const nextPhaseTasks = yield* dbQuery(() =>
      db.query.tasks.findMany({
        where: { prdRevisionId: id, phaseNumber: currentPhase + 1, reviewId: { isNull: true } },
      }),
    );

    // Capture SHA for the phase snapshot (best-effort).
    let sha: string | null = null;
    if (rev.workspaceId) {
      const ws = yield* dbQuery(() =>
        db.query.workspaces.findFirst({ where: { id: rev.workspaceId! } }),
      );
      if (ws) sha = yield* captureSha(ws.path);
    }

    // Upsert the phase snapshot. Re-running phaseAdvance on the same phase
    // is rare but harmless — we update the SHA in place.
    yield* upsertPhaseSnapshot(id, currentPhase, { advancedAtSha: sha });

    if (nextPhaseTasks.length > 0) {
      // User approved this phase's work — flip back to in_progress AND bump
      // currentPhase so the orchestrator can spawn the next coder pass.
      const rows = yield* dbQuery(() =>
        db
          .update(prdRevisions)
          .set({ status: "in_progress", currentPhase: currentPhase + 1 })
          .where(eq(prdRevisions.id, id))
          .returning(),
      );
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: id,
        eventType: "phase_advanced",
        payload: {
          prdRevisionId: id,
          fromPhase: currentPhase,
          toPhase: currentPhase + 1,
          ...(sha ? { sha } : {}),
        },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return { prd: rows[0]!, advanced: true as const };
    } else {
      const rows = yield* dbQuery(() =>
        db
          .update(prdRevisions)
          .set({ status: "done", ...(sha ? { doneAtSha: sha } : {}) })
          .where(eq(prdRevisions.id, id))
          .returning(),
      );
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: id,
        eventType: "phase_advanced",
        payload: {
          prdRevisionId: id,
          fromPhase: currentPhase,
          toPhase: undefined,
          ...(sha ? { sha } : {}),
        },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: id,
        eventType: "prd_done",
        payload: { prdRevisionId: id, title: rev.title, ...(sha ? { sha } : {}) },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return { prd: rows[0]!, advanced: false as const };
    }
  });

// ── Phase snapshots ───────────────────────────────────────────────────────────

export const upsertPhaseSnapshot = (
  prdRevisionId: string,
  phaseNumber: number,
  patch: {
    advancedAtSha?: string | null;
    reviewBrief?: string | null;
    suggestedCommitMessage?: string | null;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const existing = yield* dbQuery(() =>
      db.query.prdPhaseSnapshots.findFirst({ where: { prdRevisionId, phaseNumber } }),
    );
    if (existing) {
      const rows = yield* dbQuery(() =>
        db
          .update(prdPhaseSnapshots)
          .set({
            advancedAtSha:
              patch.advancedAtSha !== undefined ? patch.advancedAtSha : existing.advancedAtSha,
            reviewBrief: patch.reviewBrief !== undefined ? patch.reviewBrief : existing.reviewBrief,
            suggestedCommitMessage:
              patch.suggestedCommitMessage !== undefined
                ? patch.suggestedCommitMessage
                : existing.suggestedCommitMessage,
          })
          .where(eq(prdPhaseSnapshots.id, existing.id))
          .returning(),
      );
      return rows[0]!;
    }
    const rows = yield* dbQuery(() =>
      db
        .insert(prdPhaseSnapshots)
        .values({
          id: generateId(),
          prdRevisionId,
          phaseNumber,
          advancedAtSha: patch.advancedAtSha ?? null,
          advancedAt: new Date(),
          reviewBrief: patch.reviewBrief ?? null,
          suggestedCommitMessage: patch.suggestedCommitMessage ?? null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const getPhaseSnapshot = (prdRevisionId: string, phaseNumber: number) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.prdPhaseSnapshots.findFirst({ where: { prdRevisionId, phaseNumber } }),
    );
    return row ?? null;
  });

export const listPhaseSnapshots = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdPhaseSnapshots.findMany({
        where: { prdRevisionId },
        orderBy: { phaseNumber: "asc" },
      }),
    );
  });

/**
 * Anchor a post-squash merge commit for one repo of a PRD.
 *
 * Replaces the single-SHA `captureMergeSha`: a multi-repo PRD anchors N
 * `prd_merge` rows, one per repo. The row is an upsert on
 * `(prdRevisionId, repoName)` so re-capturing a repo replaces its SHA.
 *
 * `repo` is a resolved repo (real `project_repo` or the implicit mono-repo).
 * The SHA is validated against the repo on disk via `assertShaExists` before
 * the row is written — anchoring a commit that does not exist is refused.
 *
 * The legacy `prd_revision.mergedAtSha` column is kept in sync with the most
 * recent capture so the diff API's legacy fallback still resolves.
 */
export const captureMerge = (input: {
  prdRevisionId: string;
  repo: { id: string | null; name: string; path: string };
  sha: string;
  capturedFrom: MergeCaptureSource;
}): Effect.Effect<PrdMergeRow, PrdNotFoundError | ShaNotFoundError | DatabaseError, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(input.prdRevisionId);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id: input.prdRevisionId }));

    yield* assertShaExists(input.repo.path, input.sha);

    const existing = yield* dbQuery(() =>
      db.query.prdMerges.findFirst({
        where: { prdRevisionId: input.prdRevisionId, repoName: input.repo.name },
      }),
    );

    let row: PrdMergeRow;
    if (existing) {
      const rows = yield* dbQuery(() =>
        db
          .update(prdMerges)
          .set({
            repoId: input.repo.id,
            repoPath: input.repo.path,
            mergeSha: input.sha,
            mergedAt: new Date(),
            capturedFrom: input.capturedFrom,
          })
          .where(eq(prdMerges.id, existing.id))
          .returning(),
      );
      row = rows[0]!;
    } else {
      const rows = yield* dbQuery(() =>
        db
          .insert(prdMerges)
          .values({
            id: generateId(),
            prdRevisionId: input.prdRevisionId,
            repoId: input.repo.id,
            repoName: input.repo.name,
            repoPath: input.repo.path,
            mergeSha: input.sha,
            mergedAt: new Date(),
            capturedFrom: input.capturedFrom,
          })
          .returning(),
      );
      row = rows[0]!;
    }

    yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({ mergedAtSha: input.sha })
        .where(eq(prdRevisions.id, input.prdRevisionId)),
    );

    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: input.prdRevisionId,
      eventType: "note",
      payload: { message: `Captured merge SHA ${input.sha} for repo '${input.repo.name}'` },
      source: "ai",
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return row;
  });

/** List the merge anchors of a PRD revision, ordered by repo name. */
export const listMerges = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.prdMerges.findMany({
        where: { prdRevisionId },
        orderBy: { repoName: "asc" },
      }),
    );
  });

export const updateSuggestedCommitMessage = (id: string, message: string | null) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({ suggestedCommitMessage: message })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );
    yield* logActivity({
      projectId: rev.projectId,
      workspaceId: rev.workspaceId ?? undefined,
      prdRevisionId: id,
      eventType: "prd_updated",
      payload: {
        prdRevisionId: id,
        title: rev.title,
        fields: ["suggestedCommitMessage"],
      },
      source: "ai",
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return rows[0]!;
  });

export const updatePrdSections = (
  id: string,
  changes: {
    problem?: string | null;
    solution?: string | null;
    implementationDecisions?: string | null;
    testingDecisions?: string | null;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const rev = yield* getPrd(id);
    if (!rev) return yield* Effect.fail(new PrdNotFoundError({ id }));
    if (rev.status !== "draft") {
      return yield* Effect.fail(new PrdNotDraftError({ id, status: rev.status }));
    }
    const fields: string[] = [];
    if (changes.problem !== undefined) fields.push("problem");
    if (changes.solution !== undefined) fields.push("solution");
    if (changes.implementationDecisions !== undefined) fields.push("implementationDecisions");
    if (changes.testingDecisions !== undefined) fields.push("testingDecisions");
    if (fields.length === 0) {
      return yield* Effect.fail(
        new DatabaseError({ cause: new Error("No PRD section changes provided") }),
      );
    }
    const rows = yield* dbQuery(() =>
      db
        .update(prdRevisions)
        .set({
          problem: changes.problem !== undefined ? changes.problem : rev.problem,
          solution: changes.solution !== undefined ? changes.solution : rev.solution,
          implementationDecisions:
            changes.implementationDecisions !== undefined
              ? changes.implementationDecisions
              : rev.implementationDecisions,
          testingDecisions:
            changes.testingDecisions !== undefined
              ? changes.testingDecisions
              : rev.testingDecisions,
        })
        .where(eq(prdRevisions.id, id))
        .returning(),
    );
    const updated = rows[0]!;
    yield* logActivity({
      projectId: updated.projectId,
      workspaceId: updated.workspaceId ?? undefined,
      prdRevisionId: updated.id,
      eventType: "prd_updated",
      payload: { prdRevisionId: updated.id, title: updated.title, fields },
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return updated;
  });

function validatePhaseSequence(tasksInput: BatchTaskInput[]) {
  const phaseNumbers = tasksInput.map((task) => task.phaseNumber ?? null);
  const hasPhases = phaseNumbers.some((phaseNumber) => phaseNumber !== null);

  if (!hasPhases) {
    return Effect.succeed(undefined);
  }

  const unphasedTaskIndex = phaseNumbers.findIndex((phaseNumber) => phaseNumber === null);
  if (unphasedTaskIndex !== -1) {
    return Effect.fail(
      new ValidationError({
        reason: `Invalid phase plan: task at index ${unphasedTaskIndex} has no phaseNumber while other tasks are phased. Either phase every task or leave every task unphased.`,
      }),
    );
  }

  const uniquePhases = [...new Set(phaseNumbers as number[])].sort((a, b) => a - b);
  if (uniquePhases[0] !== 1) {
    return Effect.fail(
      new ValidationError({
        reason: `Invalid phase plan: phases must start at 1, found ${uniquePhases[0]}.`,
      }),
    );
  }

  for (let i = 0; i < uniquePhases.length; i++) {
    const expectedPhase = i + 1;
    const actualPhase = uniquePhases[i]!;
    if (actualPhase !== expectedPhase) {
      return Effect.fail(
        new ValidationError({
          reason: `Invalid phase plan: phases must be contiguous starting at 1, missing phase ${expectedPhase}.`,
        }),
      );
    }
  }

  return Effect.succeed(undefined);
}
