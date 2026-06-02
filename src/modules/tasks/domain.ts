import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { prdRevisions, tasks } from "#/db/schema";
import { generateId } from "#/shared/utils";
import { normalizeTaskDescriptionForStorage } from "#/modules/tasks/spec";
import {
  VALID_TASK_TRANSITIONS,
  type TaskStatus,
  type Effort,
  type SeverityLevel,
  type TaskKind,
  type TriageState,
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
import { assertTaskRepoInPrdScope } from "#/modules/prds/repos";
import { getWorkspace } from "#/modules/workspaces/domain";
import { assertSafeShellCommand } from "#/modules/projects/directives";

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
  kind?: TaskKind;
  repoId?: string | null;
  /**
   * Optional shell command run by `depot task verify` (PRD 0018). Only
   * persisted for `kind = "human"` tasks; supplying it on any other kind is
   * rejected as a contract error.
   */
  verificationCommand?: string | null;
}) =>
  Effect.gen(function* () {
    if (!input.doneCriteria || input.doneCriteria.trim() === "") {
      return yield* Effect.fail(
        new ValidationError({ reason: "Task must have non-empty done_criteria" }),
      );
    }

    const verificationCommand =
      input.verificationCommand !== undefined &&
      input.verificationCommand !== null &&
      input.verificationCommand.trim() !== ""
        ? input.verificationCommand.trim()
        : null;

    if (verificationCommand !== null && input.kind !== "human") {
      return yield* Effect.fail(
        new ValidationError({
          reason: "verificationCommand can only be set on tasks with kind=human.",
        }),
      );
    }

    if (verificationCommand !== null) {
      try {
        assertSafeShellCommand(verificationCommand, "verification command");
      } catch (e) {
        return yield* Effect.fail(
          new ValidationError({ reason: e instanceof Error ? e.message : String(e) }),
        );
      }
    }

    const db = yield* Db;

    yield* assertTaskRepoInPrdScope(input.prdRevisionId, input.repoId ?? null);

    // Auto-seed multi-phase mode the first time a task is added with --phase.
    // Without this, `depot task add --phase N` leaves `prd_revisions.currentPhase`
    // at NULL and the next `depot prd phase-advance` refuses with "no phases
    // defined". We always seed at 1 regardless of N — phase progression is
    // driven by subsequent `phase-advance` calls.
    if (input.phaseNumber !== undefined && input.phaseNumber !== null) {
      const rev = yield* dbQuery(() =>
        db.query.prdRevisions.findFirst({ where: { id: input.prdRevisionId } }),
      );
      if (rev && rev.currentPhase === null) {
        yield* dbQuery(() =>
          db
            .update(prdRevisions)
            .set({ currentPhase: 1, updatedAt: new Date() })
            .where(eq(prdRevisions.id, input.prdRevisionId)),
        );
      }
    }

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
          kind: input.kind ?? "slice",
          phaseNumber: input.phaseNumber ?? null,
          status: "pending",
          repoId: input.repoId ?? null,
          blockedReason: null,
          skipReason: null,
          verificationCommand,
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
    kind?: TaskKind;
    phaseNumber?: number | null;
    dependsOn?: string[];
    addDependsOn?: string[];
    removeDependsOn?: string[];
    severity?: SeverityLevel | null;
    repoId?: string | null;
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
      changes.kind !== undefined ? "kind" : null,
      changes.phaseNumber !== undefined ? "phaseNumber" : null,
      changes.dependsOn !== undefined ||
      changes.addDependsOn !== undefined ||
      changes.removeDependsOn !== undefined
        ? "dependsOn"
        : null,
      changes.severity !== undefined ? "severity" : null,
      changes.repoId !== undefined ? "repoId" : null,
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

    if (changes.repoId !== undefined) {
      yield* assertTaskRepoInPrdScope(task.prdRevisionId, changes.repoId);
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
          kind: changes.kind ?? task.kind,
          phaseNumber: changes.phaseNumber !== undefined ? changes.phaseNumber : task.phaseNumber,
          dependsOn: nextDependsOn ?? task.dependsOn,
          severity: changes.severity !== undefined ? changes.severity : task.severity,
          repoId: changes.repoId !== undefined ? changes.repoId : task.repoId,
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

// ── Human task verification (PRD 0018) ───────────────────────────────────────

const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;
const MAX_VERIFY_OUTPUT_BYTES = 8 * 1024;

const truncateForLog = (s: string): string => {
  if (Buffer.byteLength(s, "utf-8") <= MAX_VERIFY_OUTPUT_BYTES) return s;
  return (
    Buffer.from(s, "utf-8").slice(0, MAX_VERIFY_OUTPUT_BYTES).toString("utf-8") + "\n...[truncated]"
  );
};

const resolveVerifyTimeoutMs = (): number => {
  const raw = process.env["DEPOT_VERIFY_TIMEOUT_MS"];
  if (!raw) return DEFAULT_VERIFY_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_VERIFY_TIMEOUT_MS;
  return parsed;
};

type VerifyExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/**
 * Run the verification command in the workspace cwd. We always go through
 * `sh -c "<cmd>"` so users can write `test -f /tmp/foo` or `pnpm test`
 * without thinking about argv splitting.
 */
const execVerificationCommand = (cwd: string, command: string): Promise<VerifyExecResult> =>
  new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const file = isWin ? "cmd.exe" : "sh";
    const args = isWin ? ["/d", "/s", "/c", command] : ["-c", command];
    execFile(
      file,
      args,
      { cwd, timeout: resolveVerifyTimeoutMs(), maxBuffer: 4 * MAX_VERIFY_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        const out = stdout?.toString() ?? "";
        const err = stderr?.toString() ?? "";
        if (error) {
          // `error.code` is the child's exit code (number) when the script
          // ran and exited non-zero, but a spawn failure (e.g. ENOENT for
          // the shell binary) sets it to a string like 'ENOENT'. Coerce
          // string codes to 1 so the activity payload stays well-typed and
          // the failure is still reported as "verification failed".
          const code = typeof error.code === "number" ? error.code : 1;
          const composedStderr = err.length > 0 ? err : (error.message ?? "");
          resolve({ exitCode: code, stdout: out, stderr: composedStderr });
          return;
        }
        resolve({ exitCode: 0, stdout: out, stderr: err });
      },
    );
  });

/**
 * `verifyTask` — confirm a `kind = "human"` task and optionally run its
 * `verification_command` (PRD 0018 / T1).
 *
 * Refuses when the task is not a human task or when it is already `done`.
 * When a command is configured, the exit code drives the result:
 *   - exit 0       → status flipped to `done`, `task_verified_human` logged
 *                    with the captured stdout/stderr/exit.
 *   - exit ≠ 0     → task stays `pending`, the same event is logged with the
 *                    failure context so the agent can show it to the user.
 * Without a command, the user's `--user-confirmation` quote alone marks the
 * task done.
 *
 * `userConfirmation` is the literal quote captured at the CLI layer
 * (`--user-confirmed`). `null` is allowed only when
 * `DEPOT_BYPASS_USER_CONFIRMATION=1` is set (the CLI enforces that gate via
 * `resolveUserConfirmation`).
 */
export const verifyTask = (id: string, opts: { userConfirmation: string | null }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));

    if (task.kind !== "human") {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Task '${task.title}' (${task.id}) has kind='${task.kind}'. Only human tasks can be verified; use 'depot task done' for agent tasks.`,
        }),
      );
    }

    if (task.status === "done") {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Task '${task.title}' (${task.id}) is already 'done'. Human tasks can only be verified once.`,
        }),
      );
    }

    const prd = yield* getPrd(task.prdRevisionId);
    if (!prd) {
      return yield* Effect.fail(
        new ValidationError({
          reason: `Task '${task.id}' has no parent PRD revision (data integrity issue).`,
        }),
      );
    }

    let execResult: VerifyExecResult | null = null;
    if (task.verificationCommand && task.verificationCommand.trim() !== "") {
      try {
        assertSafeShellCommand(task.verificationCommand, "verification command");
      } catch (e) {
        return yield* Effect.fail(
          new ValidationError({ reason: e instanceof Error ? e.message : String(e) }),
        );
      }

      let cwd = process.cwd();
      if (prd.workspaceId) {
        const ws = yield* getWorkspace(prd.workspaceId);
        // The workspace path is the canonical cwd for the verification
        // command. We fall back to `process.cwd()` if the workspace was
        // registered with a path that no longer exists on disk (legacy
        // fixtures, orphaned workspace rows), so a stale registration does
        // not turn every verify into an ENOENT crash.
        if (ws && existsSync(ws.path)) cwd = ws.path;
      }

      execResult = yield* Effect.promise(() =>
        execVerificationCommand(cwd, task.verificationCommand!),
      );
    }

    const verifiedOk = execResult === null || execResult.exitCode === 0;

    const payload: Record<string, unknown> = {
      taskId: task.id,
      userConfirmation: opts.userConfirmation,
    };
    if (execResult !== null) {
      payload["verificationExitCode"] = execResult.exitCode;
      payload["verificationStdout"] = truncateForLog(execResult.stdout);
      payload["verificationStderr"] = truncateForLog(execResult.stderr);
    }

    if (verifiedOk) {
      const now = new Date();
      const updateValues: Partial<typeof tasks.$inferInsert> = {
        status: "done",
        completedAt: now,
      };
      // Human tasks usually never go through `task start`, so `startedAt` is
      // null. Stamp it on the verify so the timeline stays consistent with
      // other completed tasks.
      if (task.startedAt === null) {
        updateValues.startedAt = now;
      }
      const rows = yield* dbQuery(() =>
        db.update(tasks).set(updateValues).where(eq(tasks.id, id)).returning(),
      );
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: task.id,
        eventType: "task_verified_human",
        payload,
        source: "human",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return { task: rows[0]!, verified: true as const, exec: execResult };
    }

    yield* logActivity({
      projectId: prd.projectId,
      workspaceId: prd.workspaceId ?? undefined,
      prdRevisionId: prd.id,
      taskId: task.id,
      eventType: "task_verified_human",
      payload,
      source: "human",
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    return { task, verified: false as const, exec: execResult };
  });

// ── Triage ────────────────────────────────────────────────────────────────────

export const triageTask = (
  id: string,
  state: TriageState,
  options: { reason?: string; source?: "ai" | "human" } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const task = yield* getTask(id);
    if (!task) return yield* Effect.fail(new TaskNotFoundError({ id }));

    const previousState = task.triageState;
    const rows = yield* dbQuery(() =>
      db.update(tasks).set({ triageState: state }).where(eq(tasks.id, id)).returning(),
    );

    const prd = yield* getPrd(task.prdRevisionId);
    if (prd) {
      yield* logActivity({
        projectId: prd.projectId,
        workspaceId: prd.workspaceId ?? undefined,
        prdRevisionId: prd.id,
        taskId: id,
        eventType: "note",
        payload: {
          message: `Triage: ${previousState} → ${state}${options.reason ? ` (${options.reason})` : ""}`,
        },
        source: options.source ?? "ai",
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return rows[0]!;
  });
