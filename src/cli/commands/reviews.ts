import { Schema, Effect } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainOutOfScope from "#/modules/prds/out-of-scope";
import { formatDate, formatRelativeTime } from "#/shared/utils";
import { parseJsonSchema } from "#/lib/json";

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
      expected: "one of human or agent",
      description: "Review type (human|agent)",
    },
  },
  run: async ({ args, output }) => {
    const review = await runEffect(
      DomainReviews.createReview({ prdRevisionId: args.prdId, type: args.type }),
    );
    if (output.isJson()) {
      output.success({ item: review });
    } else {
      output.print(
        `Created review ${review.id} [${review.type}] for PRD ${review.prdRevisionId} [draft]`,
      );
    }
  },
});

function makeBeginRunner() {
  return async ({
    args,
    output,
  }: {
    args: { reviewId: string };
    output: import("#/cli/command").CommandOutput;
  }) => {
    const review = await runEffect(
      DomainReviews.startReview(args.reviewId).pipe(
        Effect.catchTag("ReviewNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!review) return output.error("not_found", `Review not found: ${args.reviewId}`);
    if (output.isJson()) {
      output.success({ item: review });
    } else {
      output.print(`Started review ${review.id} [in_progress]`);
    }
  };
}

const beginCommand = command({
  meta: { name: "begin", description: "Validate a review draft and move it to in_progress" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
  },
  run: makeBeginRunner(),
});

const activateCommand = command({
  meta: {
    name: "activate",
    description: "Validate a review draft and move it to in_progress (alias for `review begin`)",
  },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
  },
  run: makeBeginRunner(),
});

const reopenCommand = command({
  meta: {
    name: "reopen",
    description:
      "Reopen a closed review (status done → in_progress) so a late finding can be added",
  },
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
      DomainReviews.reopenReview(args.reviewId).pipe(
        Effect.catchTag("ReviewNotFoundError", () => Effect.succeed(null)),
        Effect.catchTag("ValidationError", (e) => {
          output.error("invalid_status", e.message);
          return Effect.succeed(null);
        }),
      ),
    );
    if (!review) return;
    if (output.isJson()) {
      output.success({ item: review });
    } else {
      output.print(`Reopened review ${review.id} [in_progress]`);
    }
  },
});

const updateCommand = command({
  meta: { name: "update", description: "Update review metadata" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
    feedback: {
      schema: Schema.String,
      description: "User feedback or review summary",
    },
  },
  run: async ({ args, output }) => {
    const review = await runEffect(DomainReviews.getReview(args.reviewId));
    if (!review) return output.error("not_found", `Review not found: ${args.reviewId}`);

    if (args.feedback === undefined) {
      return output.error("no_changes", "No changes provided. Use --feedback.");
    }

    const updated = await runEffect(
      DomainReviews.updateReview(review.id, { userFeedback: args.feedback }),
    );

    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Updated review ${updated.id} [${updated.status}]`);
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
      expected: "non-empty text",
      description: "Task description",
    },
    doneCriteria: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      expected: "non-empty text",
      description: "Done criteria",
    },
    severity: {
      schema: Schema.Literal("critical", "major", "minor", "info"),
      expected: "one of critical, major, minor, or info",
      description: "Finding severity",
    },
    axis: {
      schema: Schema.Literal("standards", "spec", "human"),
      expected: "one of standards, spec, or human",
      description: "Review axis (standards/spec for audit reviews, human for human reviews)",
    },
  },
  run: async ({ args, output }) => {
    const task = await runEffect(
      DomainReviews.addReviewTask(args.reviewId, {
        title: args.title,
        description: args.description,
        doneCriteria: args.doneCriteria,
        severity: args.severity,
        axis: args.axis,
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

const reviewTaskBatchInputSchema = Schema.Array(
  Schema.Struct({
    title: Schema.String.pipe(Schema.minLength(1)),
    description: Schema.String.pipe(Schema.minLength(1)),
    doneCriteria: Schema.String.pipe(Schema.minLength(1)),
    severity: Schema.optional(Schema.Literal("critical", "major", "minor", "info")),
  }),
).pipe(Schema.minItems(1));

const taskAddBatchCommand = command({
  meta: { name: "add-batch", description: "Add multiple tasks to a review from a JSON file" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
    file: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "f",
      description: "Path to JSON file with array of findings",
    },
  },
  run: async ({ args, output }) => {
    let rawContent: string;
    try {
      rawContent = await readFile(args.file, "utf-8");
    } catch (e) {
      return output.error(
        "file_read_error",
        `Cannot read file '${args.file}': ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const parseResult = parseJsonSchema(rawContent, reviewTaskBatchInputSchema);
    if (!parseResult.ok) {
      return output.error(parseResult.kind, parseResult.message);
    }

    const createdTasks = await runEffect(
      DomainReviews.addReviewTaskBatch(args.reviewId, [...parseResult.data]).pipe(
        Effect.catchTag("ReviewNotFoundError", () => Effect.succeed(null)),
      ),
    );

    if (!createdTasks) return output.error("not_found", `Review not found: ${args.reviewId}`);

    if (output.isJson()) {
      output.success({ items: createdTasks });
    } else {
      output.print(`Added ${createdTasks.length} task(s) to review ${args.reviewId}`);
      for (const task of createdTasks) {
        const sev = task.severity ? ` [${task.severity}]` : "";
        output.print(`  - ${task.id} ${task.title}${sev}`);
      }
    }
  },
});

const taskListCommand = command({
  meta: { name: "list", description: "List tasks for a review" },
  workspace: true,
  args: {
    reviewId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Review ID",
    },
    status: {
      schema: Schema.Literal("pending", "in_progress", "blocked", "done", "skipped"),
      expected: "one of pending, in_progress, blocked, done, skipped",
      description: "Filter by task status",
    },
  },
  run: async ({ args, output }) => {
    const review = await runEffect(DomainReviews.getReview(args.reviewId));
    if (!review) return output.error("not_found", `Review not found: ${args.reviewId}`);

    let reviewTasks = await runEffect(DomainReviews.listReviewTasks(args.reviewId));
    if (args.status) {
      reviewTasks = reviewTasks.filter((t) => t.status === args.status);
    }

    if (output.isJson()) {
      output.success({ items: reviewTasks });
      return;
    }
    if (reviewTasks.length === 0) {
      output.print("No tasks found.");
      return;
    }
    for (const task of reviewTasks) {
      const sev = task.severity ? ` [${task.severity}]` : "";
      output.print(`${task.id}  #${task.position}  ${task.title}${sev}  [${task.status}]`);
    }
  },
});

const taskTriageCommand = command({
  meta: { name: "triage", description: "Set the triage state on a review task" },
  args: {
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
    state: {
      schema: Schema.Literal(
        "needs-triage",
        "needs-info",
        "ready-for-agent",
        "ready-for-human",
        "wontfix",
      ),
      required: true,
      positional: true,
      description: "Triage state",
    },
    reason: { schema: Schema.String, alias: "r", description: "Reason for the triage decision" },
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainTasks.triageTask(args.taskId, args.state, {
        reason: args.reason,
        source: "human",
      }),
    );

    // wontfix on a review task also writes an out-of-scope item linked back.
    if (args.state === "wontfix") {
      const prd = await runEffect(DomainPrds.getPrd(updated.prdRevisionId));
      if (prd) {
        await runEffect(
          DomainOutOfScope.addOutOfScope({
            projectId: prd.projectId,
            prdRevisionId: prd.id,
            title: updated.title,
            reason: args.reason ?? "Triaged wontfix from review",
            linkedReviewTaskId: updated.id,
          }),
        );
      }
    }

    if (output.isJson()) output.success({ item: updated });
    else
      output.print(
        `Task ${updated.id} triaged → ${args.state}${args.reason ? ` (${args.reason})` : ""}`,
      );
  },
});

const taskCommand = command({
  meta: { name: "task", description: "Manage review tasks" },
  subCommands: {
    add: taskAddCommand,
    "add-batch": taskAddBatchCommand,
    list: taskListCommand,
    triage: taskTriageCommand,
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
        ["PRD", review.prdRevisionId],
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

    const summaries = await Promise.all(
      reviewList.map(async (r) => {
        const tasks = await runEffect(DomainReviews.listReviewTasks(r.id));
        const counts: Record<string, number> = {};
        for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
        const breakdown = Object.entries(counts)
          .map(([s, n]) => `${n}${s[0]}`)
          .join("/");
        return { review: r, taskCount: tasks.length, breakdown };
      }),
    );

    output.print(
      `${"ID".padEnd(28)} ${"TYPE".padEnd(7)} ${"STATUS".padEnd(13)} ${"TASKS".padEnd(14)} CREATED`,
    );
    for (const { review, taskCount, breakdown } of summaries) {
      const created = formatRelativeTime(review.createdAt);
      const tasks = breakdown ? `${taskCount} (${breakdown})` : `${taskCount}`;
      output.print(
        `${review.id.padEnd(28)} ${review.type.padEnd(7)} ${review.status.padEnd(13)} ${tasks.padEnd(14)} ${created}`,
      );
    }
  },
});

export const reviewCommand = command({
  meta: { name: "review", description: "Review management" },
  subCommands: {
    start: startCommand,
    begin: beginCommand,
    activate: activateCommand,
    reopen: reopenCommand,
    update: updateCommand,
    task: taskCommand,
    done: doneCommand,
    show: showCommand,
    list: listCommand,
  },
});
