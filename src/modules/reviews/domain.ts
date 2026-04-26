import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { reviews, tasks, prds } from "#/db/schema";
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

export const createReview = (input: { prdId: string; type: ReviewType }) =>
  Effect.gen(function* () {
    const db = yield* Db;

    if (input.type === "agent") {
      const prd = yield* dbQuery(() => db.query.prds.findFirst({ where: { id: input.prdId } }));
      if (prd) {
        if (prd.auditCycles >= MAX_AUDIT_CYCLES) {
          return yield* Effect.fail(
            new ValidationError({
              reason: `Max audit cycles reached (${MAX_AUDIT_CYCLES}/${MAX_AUDIT_CYCLES}). Report to dev.`,
            }),
          );
        }
        yield* dbQuery(() =>
          db
            .update(prds)
            .set({ auditCycles: prd.auditCycles + 1 })
            .where(eq(prds.id, input.prdId)),
        );
      }
    }

    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(reviews)
        .values({
          id,
          prdId: input.prdId,
          type: input.type,
          status: "draft",
          userFeedback: null,
          doneAt: null,
        })
        .returning(),
    );
    return rows[0]!;
  });

export const getReview = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const row = yield* dbQuery(() => db.query.reviews.findFirst({ where: { id } }));
    return row ?? null;
  });

export const listReviews = (prdId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* dbQuery(() =>
      db.query.reviews.findMany({
        where: { prdId },
        orderBy: { createdAt: "asc" },
      }),
    );
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
    return rows[0]!;
  });

export const doneReview = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    const review = yield* getReview(id);
    if (!review) return yield* Effect.fail(new ReviewNotFoundError({ id }));
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
        db.update(prds).set({ auditCycles: 0 }).where(eq(prds.id, review.prdId)),
      );
    }
    return rows[0]!;
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

    // Auto-transition draft → in_progress when the first task is added
    if (review.status === "draft") {
      yield* dbQuery(() =>
        db.update(reviews).set({ status: "in_progress" }).where(eq(reviews.id, reviewId)),
      );
    } else if (review.status !== "in_progress") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          entity: "review",
          from: review.status,
          to: "in_progress",
          allowed: [],
        }),
      );
    }

    // Get prdId from review to link the task correctly
    const prdId = review.prdId;

    const existing = yield* dbQuery(() => db.query.tasks.findMany({ where: { prdId } }));
    const nextPosition = existing.length + 1;
    const storedDescription = normalizeTaskDescriptionForStorage(input.description);

    const id = generateId();
    const rows = yield* dbQuery(() =>
      db
        .insert(tasks)
        .values({
          id,
          prdId,
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
    return rows[0]!;
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

    if (review.status === "draft") {
      yield* dbQuery(() =>
        db.update(reviews).set({ status: "in_progress" }).where(eq(reviews.id, reviewId)),
      );
    } else if (review.status !== "in_progress") {
      return yield* Effect.fail(
        new InvalidTransitionError({
          entity: "review",
          from: review.status,
          to: "in_progress",
          allowed: [],
        }),
      );
    }

    const prdId = review.prdId;
    const existing = yield* dbQuery(() => db.query.tasks.findMany({ where: { prdId } }));
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
            prdId,
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
