import { Effect, Schema } from "effect";
import { activityLog } from "#/db/schema";
import { Db } from "#/services/database";
import {
  ProjectNotFoundError,
  WorkspaceNotFoundError,
  PrdNotFoundError,
  TaskNotFoundError,
  ValidationError,
  CrossEntityError,
} from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { activityPayloadSchemas } from "#/shared/schemas";
import type { EventType } from "#/shared/validator";

// ── Functions ─────────────────────────────────────────────────────────────────

export const logActivity = (input: {
  projectId: string;
  workspaceId?: string;
  prdId?: string;
  taskId?: string;
  eventType: EventType;
  payload: Record<string, unknown>;
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

    // Validate workspace (if provided)
    if (input.workspaceId) {
      const workspace = yield* dbQuery(() =>
        db.query.workspaces.findFirst({ where: { id: input.workspaceId } }),
      );
      if (!workspace)
        return yield* Effect.fail(new WorkspaceNotFoundError({ id: input.workspaceId }));
      if (workspace.projectId !== input.projectId) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `Workspace '${input.workspaceId}' does not belong to project '${input.projectId}'`,
          }),
        );
      }
    }

    // Validate PRD (if provided)
    let prd = null;
    if (input.prdId) {
      prd = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: input.prdId } }));
      if (!prd) return yield* Effect.fail(new PrdNotFoundError({ id: input.prdId }));
      if (prd.projectId !== input.projectId) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `PRD '${input.prdId}' does not belong to project '${input.projectId}'`,
          }),
        );
      }
      if (input.workspaceId && prd.workspaceId !== null && prd.workspaceId !== input.workspaceId) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `PRD '${input.prdId}' does not belong to workspace '${input.workspaceId}'`,
          }),
        );
      }
    }

    // Validate task (if provided)
    if (input.taskId) {
      const task = yield* dbQuery(() => db.query.tasks.findFirst({ where: { id: input.taskId } }));
      if (!task) return yield* Effect.fail(new TaskNotFoundError({ id: input.taskId }));

      const taskPrd =
        prd && prd.id === task.prdId
          ? prd
          : yield* dbQuery(() => db.query.prds.findFirst({ where: { id: task.prdId } }));

      if (!taskPrd) {
        return yield* Effect.fail(new PrdNotFoundError({ id: task.prdId }));
      }
      if (taskPrd.projectId !== input.projectId) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `Task '${input.taskId}' does not belong to project '${input.projectId}'`,
          }),
        );
      }
      if (
        input.workspaceId &&
        taskPrd.workspaceId !== null &&
        taskPrd.workspaceId !== input.workspaceId
      ) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `Task '${input.taskId}' does not belong to workspace '${input.workspaceId}'`,
          }),
        );
      }
      if (prd && taskPrd.id !== prd.id) {
        return yield* Effect.fail(
          new CrossEntityError({
            reason: `Task '${input.taskId}' does not belong to PRD '${prd.id}'`,
          }),
        );
      }
    }

    const rows = yield* dbQuery(() =>
      db
        .insert(activityLog)
        .values({
          projectId: input.projectId,
          workspaceId: input.workspaceId ?? null,
          prdId: input.prdId ?? null,
          taskId: input.taskId ?? null,
          eventType: input.eventType,
          payload: JSON.stringify(input.payload),
        })
        .returning(),
    );
    return rows[0]!;
  });

export const listActivity = (filter: { projectId: string; workspaceId?: string; limit?: number }) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const where = filter.workspaceId
      ? { projectId: filter.projectId, workspaceId: filter.workspaceId }
      : { projectId: filter.projectId };

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
      return String(payload.title ?? "");
    case "prd_forked":
      return `${String(payload.sourcePrdId ?? "")} → ${String(payload.newPrdId ?? "")} (rev ${String(payload.revision ?? "")})`;
    case "review_created":
      return `${String(payload.reviewId ?? "")} [${String(payload.type ?? "")}]`;
    case "review_updated":
      return `${String(payload.reviewId ?? "")} — ${formatFieldList(payload.fields)}`;
    case "review_started":
    case "review_done":
      return String(payload.reviewId ?? "");
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
