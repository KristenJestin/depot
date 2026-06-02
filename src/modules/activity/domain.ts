import { Effect, Schema } from "effect";
import { activityLog } from "#/db/schema";
import { Db } from "#/services/database";
import {
  ProjectNotFoundError,
  PrdNotFoundError,
  TaskNotFoundError,
  ValidationError,
  CrossEntityError,
} from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { activityPayloadSchemas } from "#/shared/schemas";
import type { ActivitySource, EventType } from "#/shared/validator";
import {
  assertWorkspaceInProject,
  assertPrdInProject,
  formatPrdWorkspaceMismatch,
  formatTaskProjectMismatch,
  formatTaskWorkspaceMismatch,
} from "#/lib/cross-entity";

// ── Repo attribution helper ───────────────────────────────────────────────────

/**
 * Look up the `project_repo.name` for a given repoId. Returns `null` if the
 * repoId is `null` or the repo no longer exists (a `removeRepo` after the
 * task was filed). Using a lookup rather than an FK on `activity_log` keeps
 * historical attribution stable across repo deletions.
 */
const resolveRepoNameById = (repoId: string | null) =>
  Effect.gen(function* () {
    if (!repoId) return null;
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.projectRepos.findFirst({ where: { id: repoId }, columns: { name: true } }),
    );
    return row?.name ?? null;
  });

// ── Functions ─────────────────────────────────────────────────────────────────

export const logActivity = (input: {
  projectId: string;
  workspaceId?: string;
  prdRevisionId?: string;
  taskId?: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  source?: ActivitySource;
  /**
   * Optional explicit repo attribution (`project_repo.name`). When omitted and
   * `taskId` is provided, the value is auto-resolved from `task.repoId` (PRD
   * 0005). Stays `null` in mono-repo projects and for events that are not
   * scoped to a single repo. Stored as a denormalised name so attribution
   * survives a later `removeRepo`.
   */
  repoName?: string | null;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;

    // Validate payload shape using Effect-native decode (no try/catch)
    const payloadSchema = activityPayloadSchemas[input.eventType];
    yield* Schema.decodeUnknown(payloadSchema)(input.payload).pipe(
      Effect.mapError(
        (e) =>
          new ValidationError({
            reason: `Invalid payload for event '${input.eventType}': ${e.message}`,
          }),
      ),
    );

    // Validate project
    const project = yield* dbQuery(() =>
      db.query.projects.findFirst({ where: { id: input.projectId } }),
    );
    if (!project) return yield* Effect.fail(new ProjectNotFoundError({ id: input.projectId }));

    // Validate workspace (if provided) — delegated to shared helper.
    if (input.workspaceId) {
      yield* assertWorkspaceInProject(input.workspaceId, input.projectId);
    }

    // Validate PRD revision (if provided)
    let prdRev = null;
    if (input.prdRevisionId) {
      prdRev = yield* assertPrdInProject(input.prdRevisionId, input.projectId);
      if (
        input.workspaceId &&
        prdRev.workspaceId !== null &&
        prdRev.workspaceId !== input.workspaceId
      ) {
        const reason = yield* formatPrdWorkspaceMismatch(
          input.prdRevisionId,
          input.workspaceId,
          prdRev.workspaceId,
        );
        return yield* Effect.fail(new CrossEntityError({ reason }));
      }
    }

    // Validate task (if provided) — also captured for repoName auto-resolution.
    let taskRow: { repoId: string | null } | null = null;
    if (input.taskId) {
      const task = yield* dbQuery(() => db.query.tasks.findFirst({ where: { id: input.taskId } }));
      if (!task) return yield* Effect.fail(new TaskNotFoundError({ id: input.taskId }));
      taskRow = { repoId: task.repoId };

      const taskRev =
        prdRev && prdRev.id === task.prdRevisionId
          ? prdRev
          : yield* dbQuery(() =>
              db.query.prdRevisions.findFirst({ where: { id: task.prdRevisionId } }),
            );

      if (!taskRev) {
        return yield* Effect.fail(new PrdNotFoundError({ id: task.prdRevisionId }));
      }
      if (taskRev.projectId !== input.projectId) {
        const reason = yield* formatTaskProjectMismatch(input.taskId, input.projectId);
        return yield* Effect.fail(new CrossEntityError({ reason }));
      }
      if (
        input.workspaceId &&
        taskRev.workspaceId !== null &&
        taskRev.workspaceId !== input.workspaceId
      ) {
        const reason = yield* formatTaskWorkspaceMismatch(input.taskId, input.workspaceId);
        return yield* Effect.fail(new CrossEntityError({ reason }));
      }
      if (prdRev && taskRev.id !== prdRev.id) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `Task '${input.taskId}' does not belong to PRD '${prdRev.id}'`,
          }),
        );
      }
    }

    // Resolve the repoName to persist: an explicit value wins, otherwise fall
    // back to the task's repoId (PRD 0005) when a task is referenced. Mono-repo
    // and non-repo-scoped events stay `null` — the schema's intent.
    let repoName: string | null;
    if (input.repoName !== undefined) {
      repoName = input.repoName;
    } else if (taskRow) {
      repoName = yield* resolveRepoNameById(taskRow.repoId);
    } else {
      repoName = null;
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(activityLog)
        .values({
          projectId: input.projectId,
          workspaceId: input.workspaceId ?? null,
          prdRevisionId: input.prdRevisionId ?? null,
          taskId: input.taskId ?? null,
          repoName,
          eventType: input.eventType,
          payload: JSON.stringify(input.payload),
          source: input.source ?? "ai",
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listActivity = (filter: {
  projectId: string;
  workspaceId?: string;
  /**
   * Restrict to a single `project_repo.name`. Skips historical rows whose
   * `repoName` is `null` (mono-repo / pre-migration). Pass `undefined` to keep
   * all rows.
   */
  repoName?: string;
  limit?: number;
}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const where: Record<string, unknown> = { projectId: filter.projectId };
    if (filter.workspaceId) where.workspaceId = filter.workspaceId;
    if (filter.repoName !== undefined) where.repoName = filter.repoName;

    const rows = yield* dbQuery(() =>
      db.query.activityLog.findMany({
        where,
        orderBy: { id: "desc" },
        limit: filter.limit,
      }),
    );
    return rows.reverse();
  });

export const listActivityForTask = (taskId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.activityLog.findMany({
        where: { taskId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

export const listActivityForRevision = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.activityLog.findMany({
        where: { prdRevisionId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Produce a human-readable one-line summary of an activity log payload.
 */
export function summarizeActivityPayload(
  eventType: string,
  payload: Record<string, unknown>,
): string {
  switch (eventType) {
    case "note":
      return String(payload.message ?? "");
    case "session_start":
      return String(payload.context ?? "New session");
    case "prd_created":
      return String(payload.title ?? "");
    case "prd_updated":
      return [String(payload.title ?? ""), formatFieldList(payload.fields)]
        .filter(Boolean)
        .join(" — ");
    case "task_created":
      return [String(payload.title ?? ""), String(payload.kind ?? "")].filter(Boolean).join(" — ");
    case "task_updated":
      return [String(payload.title ?? ""), formatFieldList(payload.fields)]
        .filter(Boolean)
        .join(" — ");
    case "task_started":
    case "task_done":
      return String(payload.title ?? "");
    case "task_blocked":
    case "task_skipped":
      return [String(payload.title ?? ""), String(payload.reason ?? "")]
        .filter(Boolean)
        .join(" — ");
    case "prd_activated":
    case "prd_ready":
    case "prd_done":
    case "prd_canceled":
    case "prd_resumed":
      return String(payload.title ?? "");
    case "prd_review_requested":
      return [String(payload.title ?? ""), String(payload.reason ?? "")]
        .filter(Boolean)
        .join(" — ");
    case "prd_forked":
      return `${String(payload.sourcePrdRevisionId ?? "")} → ${String(payload.newPrdRevisionId ?? "")} (rev ${String(payload.revision ?? "")})`;
    case "review_created":
      return `${String(payload.reviewId ?? "")} [${String(payload.type ?? "")}]`;
    case "review_updated":
      return `${String(payload.reviewId ?? "")} — ${formatFieldList(payload.fields)}`;
    case "review_started":
    case "review_done":
    case "review_reopened":
      return String(payload.reviewId ?? "");
    case "task_reactivated":
      return String(payload.title ?? "");
    case "task_deleted":
      return String(payload.title ?? "");
    case "task_verified_human": {
      const exit = payload.verificationExitCode;
      const quote = payload.userConfirmation;
      const quoteSummary = typeof quote === "string" && quote.length > 0 ? `"${quote}"` : "(ack)";
      if (typeof exit === "number") {
        return `${quoteSummary} — verification exited ${exit}`;
      }
      return `${quoteSummary} — ack only`;
    }
    case "prd_approved": {
      const by = payload.approvedBy ? String(payload.approvedBy) : null;
      const cmt = payload.comment ? String(payload.comment) : null;
      return [by ? `by ${by}` : null, cmt].filter(Boolean).join(" — ");
    }
    case "coder_progress": {
      const stage = String(payload.stage ?? "");
      const msg = String(payload.message ?? "");
      const file = payload.file ? ` (${String(payload.file)})` : "";
      const tool = payload.tool ? `[${String(payload.tool)}] ` : "";
      return `${tool}${stage}: ${msg}${file}`;
    }
    case "phase_advanced": {
      const from = payload.fromPhase;
      const to = payload.toPhase;
      return to !== undefined ? `phase ${from} → ${to}` : `phase ${from} (final)`;
    }
    case "prd_phase_initialized": {
      const to = payload.toPhase;
      const derived = payload.derivedFromTasks ? " (derived from tasks)" : "";
      return `currentPhase ← ${to}${derived}`;
    }
    case "error":
      return String(payload.message ?? "");
    default:
      return JSON.stringify(payload);
  }
}

function formatFieldList(fields: unknown): string {
  if (!Array.isArray(fields) || fields.length === 0) {
    return "";
  }

  return `updated ${fields.map((field) => String(field)).join(", ")}`;
}
