import { defineValidatedCommand } from "#/cli/command";
import { resolveCurrentWorkspace } from "#/cli/runtime";
import { outputSuccess, outputError, isJsonMode } from "#/cli/output";
import {
  createReview,
  startReview,
  getReview,
  listReviews,
  recordReviewFindings,
  recordReviewDecision,
  getPrd,
  listPrds,
} from "#/lib/workflow";
import { log } from "#/lib/logger";
import { VALID_REVIEW_DECISIONS, VALID_REVIEW_MODES } from "#/lib/validator";
import * as z from "zod";

// ── start ─────────────────────────────────────────────────────────────────────

const startSchema = z.object({
  prdId: z.string().min(1).optional(),
  mode: z.enum(VALID_REVIEW_MODES).default("autonomous"),
  feedback: z.string().min(1).optional(),
});

const startCommand = defineValidatedCommand({
  schema: startSchema,
  meta: { name: "start", description: "Start a review for the active or specified PRD" },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID (defaults to the active PRD in the current workspace)",
      required: false,
    },
    mode: {
      type: "string",
      alias: "m",
      description: "Review mode: autonomous or assisted",
    },
    feedback: {
      type: "string",
      alias: "f",
      description: "User feedback for assisted mode (free text)",
    },
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();

    let prdId = args.prdId;

    if (!prdId) {
      // Resolve the active PRD for this workspace
      const allPrds = await listPrds(db, { workspaceId: ws.id });
      const activePrd = allPrds.find((p) => p.status === "in_progress");
      if (!activePrd) {
        outputError("not_found", "No active PRD found for this workspace. Provide a PRD ID.");
      }
      prdId = activePrd.id;
    }

    const prd = await getPrd(db, prdId);
    if (!prd) {
      outputError("not_found", `PRD not found: ${prdId}`);
    }

    if (args.mode === "assisted" && !args.feedback) {
      outputError(
        "validation",
        "Assisted mode requires --feedback with user input. Provide free-text feedback to start the review.",
      );
    }

    const review = await createReview(db, {
      prdId: prd.id,
      mode: args.mode,
      userFeedback: args.feedback,
    });

    if (isJsonMode()) {
      outputSuccess({ item: review });
    } else {
      console.log(
        `Started review '${review.id}' for PRD '${prd.title}' (${prd.id}) [${review.mode}]`,
      );
      console.log(`Run \`depot context review\` to load the full review context.`);
      if (review.mode === "assisted" && review.userFeedback) {
        console.log(`Feedback: ${review.userFeedback}`);
      }
    }
  },
});

// ── show ──────────────────────────────────────────────────────────────────────

const showSchema = z.object({
  reviewId: z.string().min(1),
});

const showCommand = defineValidatedCommand({
  schema: showSchema,
  meta: { name: "show", description: "Show review details" },
  args: {
    reviewId: {
      type: "positional",
      description: "Review ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const review = await getReview(db, args.reviewId);
    if (!review) {
      outputError("not_found", `Review not found: ${args.reviewId}`);
    }
    if (isJsonMode()) {
      outputSuccess({ item: review });
    } else {
      log.fields([
        ["ID", review.id],
        ["PRD", review.prdId],
        ["Revision", review.prdRevision],
        ["Status", review.status],
        ["Mode", review.mode],
        ["Decision", review.decision ?? "none"],
        ["Decision Note", review.decisionNote],
        ["User Feedback", review.userFeedback],
        ["Created", review.createdAt],
        ["Completed", review.completedAt],
      ]);
      if (review.findings !== "[]") {
        console.log("Findings:");
        const findings = JSON.parse(review.findings) as unknown[];
        for (const f of findings) {
          console.log(`  ${JSON.stringify(f)}`);
        }
      }
      if (review.followupTasks !== "[]") {
        console.log("Follow-up tasks:");
        const followups = JSON.parse(review.followupTasks) as unknown[];
        for (const t of followups) {
          console.log(`  ${JSON.stringify(t)}`);
        }
      }
    }
  },
});

// ── list ──────────────────────────────────────────────────────────────────────

const listSchema = z.object({
  prdId: z.string().min(1).optional(),
});

const listCommand = defineValidatedCommand({
  schema: listSchema,
  meta: { name: "list", description: "List reviews for the active or specified PRD" },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID (defaults to the active PRD)",
      required: false,
    },
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();

    let prdId = args.prdId;
    if (!prdId) {
      const allPrds = await listPrds(db, { workspaceId: ws.id });
      const activePrd = allPrds.find((p) => p.status === "in_progress");
      if (!activePrd) {
        outputError("not_found", "No active PRD found for this workspace. Provide a PRD ID.");
      }
      prdId = activePrd.id;
    }

    const reviewList = await listReviews(db, prdId);
    if (isJsonMode()) {
      outputSuccess({ items: reviewList });
      return;
    }
    if (reviewList.length === 0) {
      console.log(`No reviews found for PRD '${prdId}'. Run \`depot review start\` to begin.`);
      return;
    }
    for (const r of reviewList) {
      const decision = r.decision ? `  decision:${r.decision}` : "";
      console.log(`${r.id}  [${r.status}]  ${r.mode}${decision}  rev ${r.prdRevision}`);
    }
  },
});

// ── findings ──────────────────────────────────────────────────────────────────

const findingsSchema = z.object({
  reviewId: z.string().min(1),
  findings: z.string().min(1),
  questions: z.string().optional(),
  followupTasks: z.string().optional(),
});

const findingsCommand = defineValidatedCommand({
  schema: findingsSchema,
  meta: {
    name: "findings",
    description: "Record structured findings for a review (agent-facing)",
  },
  args: {
    reviewId: {
      type: "positional",
      description: "Review ID",
      required: true,
    },
    findings: {
      type: "string",
      description: "JSON array of finding objects [{title, severity, description}]",
      required: true,
    },
    questions: {
      type: "string",
      description: "JSON array of clarification questions [{question, context}]",
    },
    followupTasks: {
      type: "string",
      alias: "follow-up-tasks",
      description: "JSON array of suggested follow-up tasks [{title, description, rationale}]",
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();

    let findingsParsed: unknown[];
    try {
      findingsParsed = JSON.parse(args.findings) as unknown[];
      if (!Array.isArray(findingsParsed)) throw new Error("findings must be a JSON array");
    } catch {
      outputError("validation", `Invalid --findings JSON: ${args.findings}`);
    }

    let questionsParsed: unknown[] = [];
    if (args.questions) {
      try {
        questionsParsed = JSON.parse(args.questions) as unknown[];
        if (!Array.isArray(questionsParsed)) throw new Error("questions must be a JSON array");
      } catch {
        outputError("validation", `Invalid --questions JSON: ${args.questions}`);
      }
    }

    let followupTasksParsed: unknown[] = [];
    if (args.followupTasks) {
      try {
        followupTasksParsed = JSON.parse(args.followupTasks) as unknown[];
        if (!Array.isArray(followupTasksParsed))
          throw new Error("followup-tasks must be a JSON array");
      } catch {
        outputError("validation", `Invalid --follow-up-tasks JSON: ${args.followupTasks}`);
      }
    }

    const review = await recordReviewFindings(db, args.reviewId, {
      findings: findingsParsed,
      questions: questionsParsed,
      followupTasks: followupTasksParsed,
    });

    if (isJsonMode()) {
      outputSuccess({ item: review });
    } else {
      console.log(`Recorded ${findingsParsed.length} finding(s) for review '${review.id}'.`);
      if (followupTasksParsed.length > 0) {
        console.log(`  ${followupTasksParsed.length} follow-up task(s) suggested.`);
      }
    }
  },
});

// ── decide ────────────────────────────────────────────────────────────────────

const decideSchema = z.object({
  reviewId: z.string().min(1),
  decision: z.enum(VALID_REVIEW_DECISIONS),
  note: z.string().min(1).optional(),
});

const decideCommand = defineValidatedCommand({
  schema: decideSchema,
  meta: {
    name: "decide",
    description: "Record the human decision for a completed review",
  },
  args: {
    reviewId: {
      type: "positional",
      description: "Review ID",
      required: true,
    },
    decision: {
      type: "string",
      alias: "d",
      description: "Decision: approved | changes_requested | rejected",
      required: true,
    },
    note: {
      type: "string",
      alias: "n",
      description: "Optional note explaining the decision",
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();

    const review = await recordReviewDecision(db, args.reviewId, {
      decision: args.decision,
      note: args.note,
    });

    if (isJsonMode()) {
      outputSuccess({ item: review });
    } else {
      console.log(`Review '${review.id}' completed with decision: ${review.decision}`);
      if (review.decisionNote) {
        console.log(`Note: ${review.decisionNote}`);
      }
    }
  },
});

// ── start (alias: activate in_progress state) ─────────────────────────────────

const activateReviewSchema = z.object({
  reviewId: z.string().min(1),
});

const activateReviewCommand = defineValidatedCommand({
  schema: activateReviewSchema,
  meta: {
    name: "activate",
    description: "Mark a pending review as in_progress (agent begins work)",
  },
  args: {
    reviewId: {
      type: "positional",
      description: "Review ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const review = await startReview(db, args.reviewId);
    if (isJsonMode()) {
      outputSuccess({ item: review });
    } else {
      console.log(`Review '${review.id}' is now in_progress.`);
    }
  },
});

// ── export ────────────────────────────────────────────────────────────────────

export const reviewCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "review", description: "Review workflow management" },
  subCommands: {
    start: startCommand,
    show: showCommand,
    list: listCommand,
    findings: findingsCommand,
    decide: decideCommand,
    activate: activateReviewCommand,
  },
});
