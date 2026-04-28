import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { reviews, tasks, prdRevisions } from "#/db/schema";
import { generateId } from "#/shared/utils";
import {
  VALID_REVIEW_TRANSITIONS,
  type ReviewStatus,
  type ReviewType,
  type SeverityLevel,
  type Effort,
} from "#/shared/validator";
import { Db } from "#/services/database";
import { InvalidTransitionError, ValidationError } from "#/shared/errors";
import { dbQuery } from "#/shared/db";
import { normalizeTaskDescriptionForStorage } from "#/modules/tasks/spec";
import { logActivity } from "#/modules/activity/domain";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_AUDIT_CYCLES = 10;

// ── Errors ────────────────────────────────────────────────────────────────────

import { Data } from "effect";

export class ReviewNotFoundError extends Data.TaggedError("ReviewNotFoundError")<{
  id: string;
}> {
  get message() {
    return `Review not found: ${this.id}`;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const checkReviewTransition = (from: ReviewStatus, to: ReviewStatus) => {
  const allowed = VALID_REVIEW_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return Effect.fail(
      new InvalidTransitionError({ entity: "review", from, to, allowed: [...allowed] }),
    );
  }
  return Effect.succeed(undefined);
};

// ── Functions ─────────────────────────────────────────────────────────────────

export const createReview = (input: { prdRevisionId: string; type: ReviewType }) =>
  Effect.gen(function* () {
    const db = yield* Db;

    if (input.type === "agent") {
      const rev = yield* dbQuery(() =>
        db.query.prdRevisions.findFirst({ where: { id: input.prdRevisionId } }),
      );
      if (rev) {
        if (rev.auditCycles >= MAX_AUDIT_CYCLES) {
          return yield* Effect.fail(
            new ValidationError({
              reason: `Max audit cycles reached (${MAX_AUDIT_CYCLES}/${MAX_AUDIT_CYCLES}). Report to dev.`,
            }),
          );
        }
        yield* dbQuery(() =>
          db
            .update(prdRevisions)
            .set({ auditCycles: rev.auditCycles + 1 })
            .where(eq(prdRevisions.id, input.prdRevisionId)),
        );
      }
    }

    const id = generateId();
    const revRow = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: input.prdRevisionId } }),
    );
    const rows = yield* dbQuery(() =>
      db
        .insert(reviews)
        .values({
          id,
          prdRevisionId: input.prdRevisionId,
          type: input.type,
          status: "draft",
          userFeedback: null,
          phaseNumber: revRow?.currentPhase ?? null,
          doneAt: null,
        })
        .returning(),
    );
    const review = rows[0]!;
    if (revRow) {
      yield* logActivity({
        projectId: revRow.projectId,
        workspaceId: revRow.workspaceId ?? undefined,
        prdRevisionId: revRow.id,
        eventType: "review_created",
        payload: { reviewId: review.id, prdRevisionId: revRow.id, type: review.type },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return review;
  });

export const getReview = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.reviews.findFirst({ where: { id } }));
    return row ?? null;
  });

export const listReviews = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.reviews.findMany({
        where: { prdRevisionId },
        orderBy: { createdAt: "asc" },
      }),
    );
  });

export const getLatestReview = (prdRevisionId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() =>
      db.query.reviews.findFirst({
        where: { prdRevisionId },
        orderBy: { createdAt: "desc" },
      }),
    );
    return row ?? null;
  });

export const startReview = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const review = yield* getReview(id);
    if (!review) return yield* Effect.fail(new ReviewNotFoundError({ id }));
    yield* checkReviewTransition(review.status, "in_progress");
    const rows = yield* dbQuery(() =>
      db.update(reviews).set({ status: "in_progress" }).where(eq(reviews.id, id)).returning(),
    );
    const started = rows[0]!;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: started.prdRevisionId } }),
    );
    if (rev) {
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: rev.id,
        eventType: "review_started",
        payload: { reviewId: started.id, prdRevisionId: rev.id },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return started;
  });

export const updateReview = (
  id: string,
  changes: {
    userFeedback?: string | null;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const review = yield* getReview(id);
    if (!review) return yield* Effect.fail(new ReviewNotFoundError({ id }));

    const fields = [changes.userFeedback !== undefined ? "userFeedback" : null].filter(
      (field): field is string => field !== null,
    );

    if (fields.length === 0) {
      return yield* Effect.fail(new ValidationError({ reason: "No review changes provided" }));
    }

    const rows = yield* dbQuery(() =>
      db
        .update(reviews)
        .set({
          userFeedback:
            changes.userFeedback !== undefined ? changes.userFeedback : review.userFeedback,
        })
        .where(eq(reviews.id, id))
        .returning(),
    );

    const updated = rows[0]!;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: updated.prdRevisionId } }),
    );
    if (rev) {
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: rev.id,
        eventType: "review_updated",
        payload: { reviewId: updated.id, prdRevisionId: rev.id, fields },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }

    return updated;
  });

export const doneReview = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const review = yield* getReview(id);
    if (!review) return yield* Effect.fail(new ReviewNotFoundError({ id }));

    if (review.status === "draft") {
      const existingTasks = yield* listReviewTasks(id);
      if (existingTasks.length > 0) {
        return yield* Effect.fail(
          new ValidationError({
            reason:
              "Cannot mark a draft review as done after adding findings. Validate it first with `depot review begin <review-id>`.",
          }),
        );
      }
    }

    yield* checkReviewTransition(review.status, "done");
    const rows = yield* dbQuery(() =>
      db
        .update(reviews)
        .set({ status: "done", doneAt: new Date() })
        .where(eq(reviews.id, id))
        .returning(),
    );
    if (review.type === "human") {
      yield* dbQuery(() =>
        db
          .update(prdRevisions)
          .set({ auditCycles: 0 })
          .where(eq(prdRevisions.id, review.prdRevisionId)),
      );
    }
    const done = rows[0]!;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: done.prdRevisionId } }),
    );
    if (rev) {
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: rev.id,
        eventType: "review_done",
        payload: { reviewId: done.id, prdRevisionId: rev.id },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return done;
  });

export const addReviewTask = (
  reviewId: string,
  input: {
    title: string;
    description: string;
    doneCriteria: string;
    severity?: SeverityLevel;
    effort?: Effort;
  },
) =>
  Effect.gen(function* () {
    if (!input.doneCriteria || input.doneCriteria.trim() === "") {
      return yield* Effect.fail(
        new ValidationError({ reason: "Task must have non-empty done_criteria" }),
      );
    }

    const db = yield* Db;
    const review = yield* getReview(reviewId);
    if (!review) return yield* Effect.fail(new ReviewNotFoundError({ id: reviewId }));

    if (review.status !== "draft" && review.status !== "in_progress") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          entity: "review",
          from: review.status,
          to: "draft|in_progress",
          allowed: [],
        }),
      );
    }

    const prdRevisionId = review.prdRevisionId;

    const existing = yield* dbQuery(() => db.query.tasks.findMany({ where: { prdRevisionId } }));
    const nextPosition = existing.length + 1;
    const storedDescription = normalizeTaskDescriptionForStorage(input.description);

    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(tasks)
        .values({
          id,
          prdRevisionId,
          position: nextPosition,
          title: input.title,
          description: storedDescription.description,
          descriptionFormat: storedDescription.descriptionFormat,
          doneCriteria: input.doneCriteria,
          dependsOn: "[]",
          effort: input.effort ?? "s",
          status: "pending",
          reviewId,
          severity: input.severity ?? null,
          blockedReason: null,
          skipReason: null,
          startedAt: null,
          completedAt: null,
        })
        .returning(),
    );
    const task = rows[0]!;
    const rev = yield* dbQuery(() =>
      db.query.prdRevisions.findFirst({ where: { id: prdRevisionId } }),
    );
    if (rev) {
      yield* logActivity({
        projectId: rev.projectId,
        workspaceId: rev.workspaceId ?? undefined,
        prdRevisionId: rev.id,
        taskId: task.id,
        eventType: "task_created",
        payload: { taskId: task.id, title: task.title, kind: "review" },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    return task;
  });

export const listReviewTasks = (reviewId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.tasks.findMany({
        where: { reviewId },
        orderBy: { position: "asc" },
      }),
    );
  });

export const addReviewTaskBatch = (
  reviewId: string,
  inputs: Array<{
    title: string;
    description: string;
    doneCriteria: string;
    severity?: SeverityLevel;
  }>,
) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const review = yield* getReview(reviewId);
    if (!review) return yield* Effect.fail(new ReviewNotFoundError({ id: reviewId }));

    if (review.status !== "draft" && review.status !== "in_progress") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          entity: "review",
          from: review.status,
          to: "draft|in_progress",
          allowed: [],
        }),
      );
    }

    const prdRevisionId = review.prdRevisionId;
    const existing = yield* dbQuery(() => db.query.tasks.findMany({ where: { prdRevisionId } }));
    let nextPosition = existing.length + 1;

    const createdTasks: (typeof tasks.$inferSelect)[] = [];

    for (const input of inputs) {
      if (!input.doneCriteria || input.doneCriteria.trim() === "") {
        return yield* Effect.fail(
          new ValidationError({ reason: "Task must have non-empty done_criteria" }),
        );
      }
      const storedDescription = normalizeTaskDescriptionForStorage(input.description);
      const id = generateId();
      const rows = yield* dbQuery(() =>
        db
          .insert(tasks)
          .values({
            id,
            prdRevisionId,
            position: nextPosition,
            title: input.title,
            description: storedDescription.description,
            descriptionFormat: storedDescription.descriptionFormat,
            doneCriteria: input.doneCriteria,
            dependsOn: "[]",
            effort: "s",
            status: "pending",
            reviewId,
            severity: input.severity ?? null,
            blockedReason: null,
            skipReason: null,
            startedAt: null,
            completedAt: null,
          })
          .returning(),
      );
      createdTasks.push(rows[0]!);
      nextPosition++;
    }

    return createdTasks;
  });
