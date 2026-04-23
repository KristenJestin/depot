import { Schema, Effect } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainReviews from "#/modules/reviews/domain";
import { formatDate } from "#/shared/utils";

const startCommand = command({
  meta: { name: "start", description: "Start a new review for a PRD" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    type: {
      schema: Schema.Literal("human", "agent"),
      required: true,
      alias: "t",
      description: "Review type (human|agent)",
    },
  },
  run: async ({ args, output }) => {
    const review = await runEffect(
      DomainReviews.createReview({ prdId: args.prdId, type: args.type }),
    );
    if (output.isJson()) {
      output.success({ item: review });
    } else {
      output.print(`Created review ${review.id} [${review.type}] for PRD ${review.prdId} [draft]`);
    }
  },
});

const taskAddCommand = command({
  meta: { name: "add", description: "Add a task to a review" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "t",
      description: "Task title",
    },
    description: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "d",
      description: "Task description",
    },
    doneCriteria: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Done criteria",
    },
    severity: {
      schema: Schema.Literal("critical", "major", "minor", "info"),
      description: "Finding severity",
    },
  },
  run: async ({ args, output }) => {
    const task = await runEffect(
      DomainReviews.addReviewTask(args.reviewId, {
        title: args.title,
        description: args.description,
        doneCriteria: args.doneCriteria,
        severity: args.severity,
      }),
    );
    if (output.isJson()) {
      output.success({ item: task });
    } else {
      output.print(
        `Added task '${task.title}' (${task.id}) to review ${args.reviewId}${task.severity ? ` [${task.severity}]` : ""}`,
      );
    }
  },
});

const taskCommand = command({
  meta: { name: "task", description: "Manage review tasks" },
  subCommands: {
    add: taskAddCommand,
  },
});

const doneCommand = command({
  meta: { name: "done", description: "Mark a review as done" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
  },
  run: async ({ args, output }) => {
    const review = await runEffect(
      DomainReviews.doneReview(args.reviewId).pipe(
        Effect.catchTag("ReviewNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!review) return output.error("not_found", `Review not found: ${args.reviewId}`);
    if (output.isJson()) {
      output.success({ item: review });
    } else {
      output.print(`Marked review ${review.id} as done`);
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show review details" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
  },
  run: async ({ args, output }) => {
    const review = await runEffect(DomainReviews.getReview(args.reviewId));
    if (!review) return output.error("not_found", `Review not found: ${args.reviewId}`);

    const reviewTasks = await runEffect(DomainReviews.listReviewTasks(args.reviewId));

    if (output.isJson()) {
      output.success({ item: review, tasks: reviewTasks });
    } else {
      output.fields([
        ["ID", review.id],
        ["PRD", review.prdId],
        ["Type", review.type],
        ["Status", review.status],
        ["User Feedback", review.userFeedback],
        ["Created", formatDate(review.createdAt)],
        ["Done", formatDate(review.doneAt)],
      ]);
      if (reviewTasks.length > 0) {
        output.print("");
        output.print(`Tasks (${reviewTasks.length}):`);
        for (const task of reviewTasks) {
          const sev = task.severity ? ` [${task.severity}]` : "";
          output.print(`  ${task.id}  ${task.title}${sev}  [${task.status}]`);
        }
      }
    }
  },
});

const listCommand = command({
  meta: { name: "list", description: "List reviews for a PRD" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
  },
  run: async ({ args, output }) => {
    const reviewList = await runEffect(DomainReviews.listReviews(args.prdId));
    if (output.isJson()) {
      output.success({ items: reviewList });
      return;
    }
    if (reviewList.length === 0) {
      output.print("No reviews found.");
      return;
    }
    for (const r of reviewList) {
      output.print(`${r.id}  [${r.type}]  [${r.status}]  PRD: ${r.prdId}`);
    }
  },
});

export const reviewCommand = command({
  meta: { name: "review", description: "Review management" },
  subCommands: {
    start: startCommand,
    task: taskCommand,
    done: doneCommand,
    show: showCommand,
    list: listCommand,
  },
});
