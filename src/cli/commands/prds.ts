import { Schema, Effect } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
import { resolveTextInput } from "#/cli/file-input";
import { runEffect } from "#/cli/runtime";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainMilestones from "#/modules/prds/milestones";
import * as DomainPriority from "#/modules/prds/priority";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainStories from "#/modules/prds/stories";
import * as DomainOutOfScope from "#/modules/prds/out-of-scope";
import * as DomainDirectives from "#/modules/projects/directives";
import * as DomainRepos from "#/modules/projects/repos";
import * as DomainPrdRepos from "#/modules/prds/repos";
import * as DomainPrdTags from "#/modules/prds/tags";
import * as DomainAnnexes from "#/modules/prds/annexes";
import * as DomainDependencies from "#/modules/prds/dependencies";
import { logActivity } from "#/modules/activity/domain";
import { effortSchema } from "#/shared/schemas";
import { formatDate, formatDateWithRelative } from "#/shared/utils";
import { parseJsonSchema } from "#/lib/json";
import {
  VALID_PRD_PRIORITIES,
  VALID_PRD_STATUSES,
  VALID_ANNEX_KINDS,
  PRD_PRIORITY_RANK,
  invalidTagReason,
  type PrdPriority,
} from "#/shared/validator";
import {
  attachUserConfirmationToLatestActivity,
  requireUserConfirmation,
  userConfirmedArg,
} from "#/cli/user-confirmation";

const createCommand = command({
  meta: { name: "create", description: "Create a new PRD in draft status" },
  workspace: true,
  args: {
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "t",
      description: "PRD title",
    },
    context: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "c",
      description: "Why this PRD exists",
    },
    contextFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read PRD context from a UTF-8 text file",
    },
    scope: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "s",
      description: "What is included and excluded",
    },
    scopeFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read PRD scope from a UTF-8 text file",
    },
    priority: {
      schema: Schema.Literal(...VALID_PRD_PRIORITIES),
      expected: `one of ${VALID_PRD_PRIORITIES.join(", ")}`,
      description: "Initial product priority (defaults to 'normal')",
    },
  },
  run: async ({ args, ws, output }) => {
    const context = await resolveTextInput({
      output,
      value: args.context,
      file: args.contextFile,
      valueFlag: "--context",
      fileFlag: "--context-file",
    });
    const scope = await resolveTextInput({
      output,
      value: args.scope,
      file: args.scopeFile,
      valueFlag: "--scope",
      fileFlag: "--scope-file",
    });
    const prd = await runEffect(
      DomainPrds.createPrd({
        projectId: ws.projectId,
        title: args.title,
        context,
        scope,
        priority: args.priority,
      }),
    );
    if (output.isJson()) {
      output.success({ item: prd });
    } else {
      output.print(`Created PRD '${prd.title}' (${prd.id}) [draft]`);
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show PRD details" },
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
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const logical = await runEffect(DomainPrds.getLogicalPrd(prd.prdId));
    const priority = (logical?.priority ?? "normal") as PrdPriority;
    const annexes = await runEffect(DomainAnnexes.listAnnexes(prd.id));

    // Broken `[annex: <name>]` mentions in any body section → soft warning,
    // never blocking (PRD 0024 / T1).
    const annexNames = new Set(annexes.map((a) => a.name));
    const referencedBody = [
      prd.context,
      prd.scope,
      prd.problem,
      prd.solution,
      prd.implementationDecisions,
      prd.testingDecisions,
    ]
      .filter((s): s is string => typeof s === "string")
      .join("\n");
    const brokenRefs = DomainAnnexes.extractAnnexRefs(referencedBody).filter(
      (name) => !annexNames.has(name),
    );

    if (output.isJson()) {
      output.success({
        item: {
          ...prd,
          priority,
          annexes: annexes.map((a) => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
            description: a.description,
          })),
          brokenAnnexRefs: brokenRefs,
        },
      });
    } else {
      const annexSummary =
        annexes.length === 0
          ? "—"
          : annexes
              .map((a) => `${a.name} (${a.kind})${a.description ? ` — ${a.description}` : ""}`)
              .join("\n");
      output.fields([
        ["ID", prd.id],
        ["Title", prd.title],
        ["Status", prd.status],
        ["Priority", priority],
        ["Revision", prd.revision],
        ["PRD", prd.prdId],
        ["Context", prd.context],
        ["Scope", prd.scope],
        ["Problem", prd.problem],
        ["Solution", prd.solution],
        ["Impl Decisions", prd.implementationDecisions],
        ["Testing Decisions", prd.testingDecisions],
        ["Annexes", annexSummary],
        ["Created", formatDate(prd.createdAt)],
        ["Ready", formatDate(prd.readyAt)],
        ["Activated", prd.activatedAt ? formatDateWithRelative(prd.activatedAt) : "—"],
      ]);
      if (annexes.length > 0) {
        output.print("(read full content with: depot prd annex cat <annex-id>)");
      }
      for (const name of brokenRefs) {
        output.print(
          `Warning: body references [annex: ${name}] but no annex named '${name}' exists on this revision.`,
        );
      }
    }
  },
});

const updateCommand = command({
  meta: { name: "update", description: "Update draft or ready PRD fields in place" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    title: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "t",
      description: "New PRD title",
    },
    context: {
      schema: Schema.String,
      alias: "c",
      description: "New PRD context",
    },
    contextFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read new PRD context from a UTF-8 text file",
    },
    scope: {
      schema: Schema.String,
      alias: "s",
      description: "New PRD scope",
    },
    scopeFile: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Read new PRD scope from a UTF-8 text file",
    },
  },
  run: async ({ args, output }) => {
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    if (
      args.title === undefined &&
      args.context === undefined &&
      args.contextFile === undefined &&
      args.scope === undefined &&
      args.scopeFile === undefined
    ) {
      return output.error(
        "no_changes",
        "No changes provided. Use --title, --context, --context-file, --scope, or --scope-file.",
      );
    }

    const context = await resolveTextInput({
      output,
      value: args.context,
      file: args.contextFile,
      valueFlag: "--context",
      fileFlag: "--context-file",
    });
    const scope = await resolveTextInput({
      output,
      value: args.scope,
      file: args.scopeFile,
      valueFlag: "--scope",
      fileFlag: "--scope-file",
    });

    const updated = await runEffect(
      DomainPrds.updatePrd(prd.id, {
        title: args.title,
        context,
        scope,
      }),
    );

    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Updated PRD '${updated.title}' (${updated.id}) [${updated.status}]`);
    }
  },
});

const listCommand = command({
  meta: {
    name: "list",
    description:
      "List PRDs for the current project (excludes canceled/done by default; use --all or --status to override)",
  },
  workspace: true,
  args: {
    status: {
      schema: Schema.String,
      expected: `comma-separated list of statuses (${VALID_PRD_STATUSES.join("|")})`,
      description: "Filter by status (comma-separated)",
    },
    all: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Include canceled and done PRDs",
    },
    limit: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      expected: "a positive integer",
      description: "Maximum number of PRDs to show",
    },
    since: {
      schema: Schema.String,
      expected: "duration like 1d, 2w, 3m",
      description: "Only PRDs updated within this window (e.g. 1d, 2w, 1m)",
    },
    sort: {
      schema: Schema.Literal("created", "updated", "status", "priority"),
      expected: "one of created, updated, status, priority",
      default: "priority",
      description:
        "Sort order (default 'priority' = critical → high → normal → low, then updatedAt desc)",
    },
    tag: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Only show PRDs tagged with this tag (kebab-case)",
    },
    dependsOn: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description:
        "Filter to PRDs that directly depend on the given PRD (accepts either the logical PRD id or a revision id)",
    },
    milestone: {
      schema: Schema.String,
      expected: "non-empty milestone (target_version)",
      description: "Only PRDs whose logical PRD targets this milestone (target_version)",
    },
    priority: {
      schema: Schema.Literal(...VALID_PRD_PRIORITIES),
      expected: `one of ${VALID_PRD_PRIORITIES.join(", ")}`,
      description: "Only PRDs whose logical PRD carries this priority",
    },
  },
  run: async ({ args, ws, output }) => {
    if (args.tag !== undefined) {
      const reason = invalidTagReason(args.tag);
      if (reason !== null) {
        return output.error("validation_error", `--tag: ${reason}`);
      }
    }

    let prdList = await runEffect(
      DomainPrds.listPrds({ projectId: ws.projectId, latestOnly: true }),
    );

    const logicalPrds = await runEffect(DomainPrds.listLogicalPrdsForProject(ws.projectId));
    const priorityByPrdId = new Map<string, PrdPriority>(
      logicalPrds.map((p) => [p.id, (p.priority ?? "normal") as PrdPriority]),
    );

    if (args.priority !== undefined) {
      const wantedPriority = args.priority;
      prdList = prdList.filter(
        (p) => (priorityByPrdId.get(p.prdId) ?? "normal") === wantedPriority,
      );
    }

    if (args.tag !== undefined) {
      const tagged = await runEffect(DomainPrdTags.listPrdsForTag(ws.projectId, args.tag));
      const allowed = new Set(tagged.map((p) => p.id));
      prdList = prdList.filter((p) => allowed.has(p.id));
    }

    if (args.dependsOn) {
      const resolution = await runEffect(DomainPrds.getPrd(args.dependsOn));
      const targetLogicalId = resolution?.prdId ?? args.dependsOn;
      const dependents = await runEffect(DomainDependencies.listDependents(targetLogicalId));
      const dependentIds = new Set(dependents.map((d) => d.id));
      prdList = prdList.filter((p) => dependentIds.has(p.prdId));
    }

    if (args.milestone !== undefined) {
      const version = args.milestone.trim();
      if (version.length === 0) {
        return output.error("validation_error", "--milestone: value must be non-empty.");
      }
      const milestonePrds = await runEffect(
        DomainMilestones.listPrdsByMilestone(ws.projectId, version),
      );
      const milestoneIds = new Set(milestonePrds.map((p) => p.id));
      prdList = prdList.filter((p) => milestoneIds.has(p.id));
    }

    if (args.status) {
      const wanted = new Set(
        args.status
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
      const valid = new Set<string>(VALID_PRD_STATUSES);
      for (const s of wanted) {
        if (!valid.has(s)) {
          return output.error(
            "validation_error",
            `--status: '${s}' is not a valid status. Expected one of ${VALID_PRD_STATUSES.join(", ")}.`,
          );
        }
      }
      prdList = prdList.filter((p) => wanted.has(p.status));
    } else if (!args.all) {
      prdList = prdList.filter((p) => p.status !== "canceled" && p.status !== "done");
    }

    if (args.since) {
      const cutoff = parseDurationCutoff(args.since);
      if (!cutoff) {
        return output.error(
          "validation_error",
          `--since: '${args.since}' is not a valid duration (use e.g. 1d, 2w, 1m).`,
        );
      }
      prdList = prdList.filter((p) => p.updatedAt && p.updatedAt.getTime() >= cutoff);
    }

    const sortKey = args.sort ?? "priority";
    prdList = [...prdList].sort((a, b) => {
      if (sortKey === "priority") {
        const aP = priorityByPrdId.get(a.prdId) ?? "normal";
        const bP = priorityByPrdId.get(b.prdId) ?? "normal";
        const rankDelta = PRD_PRIORITY_RANK[bP] - PRD_PRIORITY_RANK[aP];
        if (rankDelta !== 0) return rankDelta;
        const aT = a.updatedAt?.getTime() ?? 0;
        const bT = b.updatedAt?.getTime() ?? 0;
        return bT - aT;
      }
      if (sortKey === "status") return a.status.localeCompare(b.status);
      const aT = (sortKey === "created" ? a.createdAt : a.updatedAt)?.getTime() ?? 0;
      const bT = (sortKey === "created" ? b.createdAt : b.updatedAt)?.getTime() ?? 0;
      return bT - aT;
    });

    if (args.limit !== undefined) {
      prdList = prdList.slice(0, args.limit);
    }

    const decorated = prdList.map((p) => ({
      ...p,
      priority: priorityByPrdId.get(p.prdId) ?? "normal",
    }));

    if (output.isJson()) {
      output.success({ items: decorated });
      return;
    }
    if (decorated.length === 0) {
      output.print("No PRDs found. Run `depot prd create` to create one.");
      return;
    }
    for (const p of decorated) {
      output.print(`${p.id}  ${p.title}  [${p.status}]  [${p.priority}]  rev ${p.revision}`);
    }
  },
});

function parseDurationCutoff(input: string): number | null {
  const match = /^\s*(\d+)\s*([smhdw])\s*$/i.exec(input) ?? /^\s*(\d+)\s*(m)\s*$/i.exec(input);
  if (!match) {
    const monthMatch = /^\s*(\d+)\s*(mo|month|months)\s*$/i.exec(input);
    if (!monthMatch) return null;
    const n = Number.parseInt(monthMatch[1]!, 10);
    return Date.now() - n * 30 * 24 * 60 * 60 * 1000;
  }
  const n = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  const ms = multipliers[unit];
  if (!ms) return null;
  return Date.now() - n * ms;
}

const activateCommand = command({
  meta: {
    name: "activate",
    description: "Activate a ready PRD (move to in_progress)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, ws, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd activate", output);
    const result = await runEffect(
      DomainPrds.activatePrd(args.prdId, ws.id).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "CrossEntityError") {
        return output.error(
          "cross_entity",
          `Cannot activate PRD '${args.prdId}' from this workspace. ${e.message}. Use \`depot workspace list\` to find a workspace in the PRD's project (or \`cd\` there before activating), or run \`depot workspace add --project <id|name>\` from the desired folder to register it as a workspace of the PRD's project.`,
        );
      }
      throw e;
    }
    const activated = result.item;
    await attachUserConfirmationToLatestActivity(activated.id, "prd_activated", userConfirmation);
    if (output.isJson()) {
      output.success({ item: activated });
    } else {
      output.print(`Activated PRD '${activated.title}' (${activated.id})`);
    }
  },
});

const readyCommand = command({
  meta: {
    name: "ready",
    description: "Mark a draft PRD as ready",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd ready", output);
    const updated = await runEffect(
      DomainPrds.markPrdReady(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
    await attachUserConfirmationToLatestActivity(updated.id, "prd_ready", userConfirmation);
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Marked PRD '${updated.title}' (${updated.id}) as ready`);
    }
  },
});

const doneCommand = command({
  meta: {
    name: "done",
    description: "Mark an in_progress PRD as done",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    approvedBy: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Name of the approver (recorded in activity log)",
    },
    comment: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Approval comment / rationale (recorded in activity log)",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd done", output);
    const updated = await runEffect(
      DomainPrds.donePrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);

    await attachUserConfirmationToLatestActivity(updated.id, "prd_done", userConfirmation);

    if (args.approvedBy || args.comment) {
      await runEffect(
        logActivity({
          projectId: updated.projectId,
          workspaceId: updated.workspaceId ?? undefined,
          prdRevisionId: updated.id,
          eventType: "prd_approved",
          payload: {
            prdRevisionId: updated.id,
            approvedBy: args.approvedBy ?? null,
            comment: args.comment ?? null,
            approvedAt: new Date().toISOString(),
          },
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }

    if (output.isJson()) {
      output.success({
        item: updated,
        approvedBy: args.approvedBy ?? null,
        comment: args.comment ?? null,
      });
    } else {
      output.print(`Marked PRD '${updated.title}' (${updated.id}) as done`);
      if (args.approvedBy) output.print(`  Approved by: ${args.approvedBy}`);
      if (args.comment) output.print(`  Comment    : ${args.comment}`);
    }
  },
});

const cancelCommand = command({
  meta: {
    name: "cancel",
    description: "Cancel a draft, ready, or in_progress PRD",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd cancel", output);
    const updated = await runEffect(
      DomainPrds.cancelPrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
    await attachUserConfirmationToLatestActivity(updated.id, "prd_canceled", userConfirmation);
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Cancelled PRD '${updated.title}' (${updated.id})`);
    }
  },
});

const requestReviewCommand = command({
  meta: {
    name: "request-review",
    description:
      "Move an in_progress PRD to 'review' — explicit human-validation gate (kanban → Review column)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    reason: {
      schema: Schema.String,
      required: false,
      description: "Optional context recorded on the prd_review_requested event",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd request-review", output);
    const updated = await runEffect(
      DomainPrds.requestReviewPrd(args.prdId, args.reason).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
    await attachUserConfirmationToLatestActivity(
      updated.id,
      "prd_review_requested",
      userConfirmation,
    );
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Requested human review on PRD '${updated.title}' (${updated.id}) [review]`);
    }
  },
});

const resumeCommand = command({
  meta: {
    name: "resume",
    description:
      "Move a PRD from 'review' back to 'in_progress' — call after the human review converges and the next coder pass is about to spawn",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd resume", output);
    const updated = await runEffect(
      DomainPrds.resumePrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
    await attachUserConfirmationToLatestActivity(updated.id, "prd_resumed", userConfirmation);
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Resumed PRD '${updated.title}' (${updated.id}) [in_progress]`);
    }
  },
});

const forkCommand = command({
  meta: {
    name: "fork",
    description: "Fork a ready PRD into a new draft revision",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID to fork",
    },
  },
  run: async ({ args, output }) => {
    const forked = await runEffect(
      DomainPrds.forkPrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null as null)),
        Effect.catchTag("ValidationError", (e) => {
          output.error("fork_not_allowed", e.message);
          return Effect.succeed(null as null);
        }),
      ),
    );
    if (!forked) return output.error("not_found", `PRD not found: ${args.prdId}`);
    if (output.isJson()) {
      output.success({ item: forked });
    } else {
      output.print(
        `Forked PRD '${forked.title}' as revision ${forked.revision} (${forked.id}) [draft]`,
      );
    }
  },
});

// ── Schema for prd load ───────────────────────────────────────────────────────

const taskInputSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.String.pipe(Schema.minLength(1)),
  doneCriteria: Schema.String.pipe(Schema.minLength(1)),
  effort: effortSchema,
  dependsOn: Schema.optional(Schema.Array(Schema.Int.pipe(Schema.nonNegative()))),
  phase: Schema.optional(Schema.Int.pipe(Schema.positive())),
});

const prdLoadSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1)),
  context: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  ready: Schema.optional(Schema.Boolean),
  tasks: Schema.Array(taskInputSchema).pipe(Schema.minItems(1)),
});

type PrdLoadInput = Schema.Schema.Type<typeof prdLoadSchema>;

// ── loadCommand ───────────────────────────────────────────────────────────────

const loadCommand = command({
  meta: { name: "load", description: "Create a PRD with tasks from a JSON document" },
  workspace: true,
  args: {
    file: {
      schema: Schema.String,
      description: "Path to JSON file (reads stdin if omitted)",
      alias: "f",
    },
  },
  run: async ({ args, ws, output }) => {
    let rawContent: string;
    if (args.file) {
      try {
        rawContent = await readFile(args.file, "utf-8");
      } catch (e) {
        return output.error(
          "file_read_error",
          `Cannot read file '${args.file}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      rawContent = Buffer.concat(chunks).toString("utf-8");
    }

    const parseResult = parseJsonSchema(rawContent, prdLoadSchema);
    if (!parseResult.ok) {
      return output.error(parseResult.kind, parseResult.message);
    }

    const data: PrdLoadInput = parseResult.data;

    for (let i = 0; i < data.tasks.length; i++) {
      const task = data.tasks[i]!;
      for (const idx of task.dependsOn ?? []) {
        if (idx >= i) {
          return output.error(
            "invalid_depends_on",
            `Task at index ${i} has invalid dependsOn index ${idx}: only backward references (index < task index) are allowed`,
          );
        }
      }
    }

    const result = await runEffect(
      DomainPrds.loadPrdBatch({
        projectId: ws.projectId,
        title: data.title,
        context: data.context,
        scope: data.scope,
        ready: data.ready,
        tasks: data.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          doneCriteria: t.doneCriteria,
          effort: t.effort,
          dependsOn: t.dependsOn,
          phaseNumber: t.phase,
        })),
      }),
    );

    const { prd: finalPrd, tasks: createdTasks } = result;

    if (output.isJson()) {
      output.success({ prd: finalPrd, tasks: createdTasks });
    } else {
      output.print(`Loaded PRD '${finalPrd.title}' (${finalPrd.id}) [${finalPrd.status}]`);
      output.print(`  Created ${createdTasks.length} task(s)`);
      for (const t of createdTasks) {
        output.print(`  - ${t.id} #${t.position} ${t.title} [${t.status}] ${t.effort}`);
      }
      if (!data.ready) {
        output.print(`  Run: depot prd ready ${finalPrd.id} to mark as ready`);
      }
    }
  },
});

// ── reloadCommand ─────────────────────────────────────────────────────────────

const reloadCommand = command({
  meta: { name: "reload", description: "Replace all content of a draft PRD in place" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Draft PRD ID to reload",
    },
    file: {
      schema: Schema.String,
      description: "Path to JSON file (reads stdin if omitted)",
      alias: "f",
    },
  },
  run: async ({ args, output }) => {
    let rawContent: string;
    if (args.file) {
      try {
        rawContent = await readFile(args.file, "utf-8");
      } catch (e) {
        return output.error(
          "file_read_error",
          `Cannot read file '${args.file}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      rawContent = Buffer.concat(chunks).toString("utf-8");
    }

    const parseResult = parseJsonSchema(rawContent, prdLoadSchema);
    if (!parseResult.ok) {
      return output.error(parseResult.kind, parseResult.message);
    }

    const data: PrdLoadInput = parseResult.data;

    for (let i = 0; i < data.tasks.length; i++) {
      const task = data.tasks[i]!;
      for (const idx of task.dependsOn ?? []) {
        if (idx >= i) {
          return output.error(
            "invalid_depends_on",
            `Task at index ${i} has invalid dependsOn index ${idx}: only backward references (index < task index) are allowed`,
          );
        }
      }
    }

    const result = await runEffect(
      DomainPrds.reloadPrdBatch({
        prdRevisionId: args.prdId,
        title: data.title,
        context: data.context,
        scope: data.scope,
        tasks: data.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          doneCriteria: t.doneCriteria,
          effort: t.effort,
          dependsOn: t.dependsOn,
          phaseNumber: t.phase,
        })),
      }).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
        Effect.catchTag("PrdNotDraftError", (e) => {
          output.error("prd_not_draft", e.message);
          return Effect.succeed(null);
        }),
      ),
    );

    if (!result) return;

    const { prd: finalPrd, tasks: updatedTasks } = result;

    if (output.isJson()) {
      output.success({ prd: finalPrd, tasks: updatedTasks });
    } else {
      output.print(`Reloaded PRD '${finalPrd.title}' (${finalPrd.id}) [${finalPrd.status}]`);
      output.print(`  Replaced with ${updatedTasks.length} task(s)`);
      for (const t of updatedTasks) {
        output.print(`  - ${t.id} #${t.position} ${t.title} [${t.status}] ${t.effort}`);
      }
    }
  },
});

// ── phaseAdvanceCommand ───────────────────────────────────────────────────────

const phaseAdvanceCommand = command({
  meta: {
    name: "phase-advance",
    description:
      "Advance a multi-phase in_progress PRD to its next phase (marks done if last phase)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd phase-advance", output);
    const result = await runEffect(
      DomainPrds.phaseAdvance(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!result) return output.error("not_found", `PRD not found: ${args.prdId}`);
    await attachUserConfirmationToLatestActivity(result.prd.id, "phase_advanced", userConfirmation);
    if (!result.advanced) {
      // The final phase also emits a `prd_done` event from the domain side.
      // Annotate it with the same confirmation so the audit trail stays
      // consistent with the user's single approval.
      await attachUserConfirmationToLatestActivity(result.prd.id, "prd_done", userConfirmation);
    }
    if (output.isJson()) {
      output.success({ item: result.prd, advanced: result.advanced });
    } else {
      if (result.advanced) {
        output.print(
          `Advanced PRD '${result.prd.title}' (${result.prd.id}) to phase ${result.prd.currentPhase}`,
        );
      } else {
        output.print(
          `Completed final phase for PRD '${result.prd.title}' (${result.prd.id}) — marked as done`,
        );
      }
    }
  },
});

// ── phase sub-tree ────────────────────────────────────────────────────────────

const phaseInitCommand = command({
  meta: {
    name: "init",
    description:
      "Seed currentPhase on a legacy PRD that was activated before phase auto-seeding shipped",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    phase: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      expected: "a positive integer",
      description:
        "Explicit phase number to set; when omitted, derived from the PRD's tasks (min pending phase, fallback to max phase)",
    },
    force: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Overwrite an existing currentPhase value",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, output }) => {
    const userConfirmation = requireUserConfirmation(args, "depot prd phase init", output);
    const result = await runEffect(
      DomainPrds.initPrdPhase(args.prdId, {
        phase: args.phase,
        force: args.force,
      }).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }
    const updated = result.item;
    await attachUserConfirmationToLatestActivity(
      updated.id,
      "prd_phase_initialized",
      userConfirmation,
    );
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(
        `Initialised PRD '${updated.title}' (${updated.id}) currentPhase = ${updated.currentPhase}`,
      );
    }
  },
});

const phaseCommand = command({
  meta: { name: "phase", description: "Phase management subcommands" },
  subCommands: { init: phaseInitCommand },
});

// ── validateCommand ───────────────────────────────────────────────────────────

const validateCommand = command({
  meta: {
    name: "validate",
    description: "Run readiness checks on a draft PRD before marking it ready",
  },
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
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    const allTasks = await runEffect(DomainTasks.listTasks(prd.id, { prdTasksOnly: true }));
    const stories = await runEffect(DomainStories.listUserStories(prd.id));
    const checks: Array<{ level: "ok" | "warn" | "error"; message: string }> = [];

    const hasText = (value: string | null | undefined): boolean =>
      typeof value === "string" && value.trim().length > 0;

    checks.push({ level: prd.title.trim().length > 0 ? "ok" : "error", message: `title set` });
    checks.push({
      level: prd.context && prd.context.trim().length > 0 ? "ok" : "warn",
      message: `context set${prd.context ? ` (${prd.context.length} chars)` : ""}`,
    });
    checks.push({
      level: prd.scope && prd.scope.trim().length > 0 ? "ok" : "warn",
      message: `scope set${prd.scope ? ` (${prd.scope.length} chars)` : ""}`,
    });

    // PRD-02 structured sections: `problem` and `solution` are mandatory; the
    // two decision sections are recommended (warn) so a draft can still be
    // iterated on before they are fully fleshed out.
    checks.push({
      level: hasText(prd.problem) ? "ok" : "error",
      message: hasText(prd.problem) ? "problem statement set" : "problem statement missing",
    });
    checks.push({
      level: hasText(prd.solution) ? "ok" : "error",
      message: hasText(prd.solution) ? "solution set" : "solution missing",
    });
    checks.push({
      level: hasText(prd.implementationDecisions) ? "ok" : "warn",
      message: hasText(prd.implementationDecisions)
        ? "implementation decisions set"
        : "implementation decisions not recorded",
    });
    checks.push({
      level: hasText(prd.testingDecisions) ? "ok" : "warn",
      message: hasText(prd.testingDecisions)
        ? "testing decisions set"
        : "testing decisions not recorded",
    });

    checks.push({
      level: stories.length > 0 ? "ok" : "error",
      message: `${stories.length} user story(ies) defined`,
    });
    checks.push({
      level: allTasks.length > 0 ? "ok" : "error",
      message: `${allTasks.length} task(s) defined`,
    });

    const idSet = new Set(allTasks.map((t) => t.id));
    let invalidDeps = 0;
    for (const t of allTasks) {
      const deps: string[] = JSON.parse(t.dependsOn);
      for (const d of deps) {
        if (!idSet.has(d)) invalidDeps++;
      }
    }
    checks.push({
      level: invalidDeps === 0 ? "ok" : "error",
      message:
        invalidDeps === 0
          ? "all task dependencies resolve to existing tasks"
          : `${invalidDeps} task dependency reference(s) point to unknown tasks`,
    });

    const cycles = detectCycles(allTasks);
    checks.push({
      level: cycles.length === 0 ? "ok" : "error",
      message:
        cycles.length === 0
          ? "no dependency cycles"
          : `${cycles.length} dependency cycle(s) detected`,
    });

    let shortCriteria = 0;
    for (const t of allTasks) {
      if (t.doneCriteria.trim().length < 30) shortCriteria++;
    }
    if (shortCriteria > 0) {
      checks.push({
        level: "warn",
        message: `${shortCriteria} task(s) have very short done_criteria (<30 chars) — consider expanding`,
      });
    } else if (allTasks.length > 0) {
      checks.push({ level: "ok", message: "all task done_criteria look substantive" });
    }

    const phasedCount = allTasks.filter((t) => t.phaseNumber !== null).length;
    if (phasedCount === 0 && allTasks.length > 5) {
      checks.push({
        level: "warn",
        message: `no phase set on any task (multi-phase PRDs encouraged for >5 tasks)`,
      });
    } else if (phasedCount > 0 && phasedCount !== allTasks.length) {
      checks.push({
        level: "error",
        message: `inconsistent phasing: ${phasedCount}/${allTasks.length} tasks are phased — either phase every task or none`,
      });
    } else if (phasedCount > 0) {
      checks.push({
        level: "ok",
        message: `multi-phase plan (${phasedCount} task(s) phased)`,
      });
    }

    // Story ↔ task coverage: every user story should drive at least one task.
    // Unlinked stories are a `warn` — a story with no implementing task is a
    // planning gap, not a hard blocker.
    if (stories.length > 0) {
      const uncovered: string[] = [];
      for (const story of stories) {
        const linked = await runEffect(DomainStories.listTasksForStory(story.id));
        if (linked.length === 0) uncovered.push(`#${story.position}`);
      }
      checks.push({
        level: uncovered.length === 0 ? "ok" : "warn",
        message:
          uncovered.length === 0
            ? "all user stories are linked to at least one task"
            : `${uncovered.length} user story(ies) not linked to any task (${uncovered.join(", ")})`,
      });
    }

    const errors = checks.filter((c) => c.level === "error").length;
    const warns = checks.filter((c) => c.level === "warn").length;
    const ready =
      prd.status === "draft" && errors === 0
        ? `Ready to mark as 'ready'. Run \`depot prd ready ${prd.id}\`.`
        : prd.status !== "draft"
          ? `PRD status is '${prd.status}' — validate is most useful on drafts.`
          : `Fix the ${errors} error(s) above before marking ready.`;

    if (output.isJson()) {
      output.success({
        prd: { id: prd.id, title: prd.title, status: prd.status },
        checks,
        summary: { errors, warnings: warns, ready: errors === 0 && prd.status === "draft" },
      });
      return;
    }

    output.print(`PRD ${prd.id} (${prd.status})`);
    for (const c of checks) {
      const icon = c.level === "ok" ? "✓" : c.level === "warn" ? "⚠" : "✗";
      output.print(`  ${icon} ${c.message}`);
    }
    output.print(`→ ${ready}`);
  },
});

function detectCycles(taskList: Array<{ id: string; dependsOn: string }>): string[][] {
  const adj = new Map<string, string[]>();
  for (const t of taskList) {
    adj.set(t.id, JSON.parse(t.dependsOn) as string[]);
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) cycles.push(stack.slice(idx).concat(node));
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      dfs(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const id of adj.keys()) dfs(id);
  return cycles;
}

// ── statusCommand ─────────────────────────────────────────────────────────────

const statusCommand = command({
  meta: { name: "status", description: "Show a compact status summary for a PRD" },
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
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    const prdTasks = await runEffect(DomainTasks.listTasks(prd.id, { prdTasksOnly: true }));
    const reviewList = await runEffect(DomainReviews.listReviews(prd.id));

    const reviewSummaries = await Promise.all(
      reviewList.map(async (r) => {
        const tasks = await runEffect(DomainReviews.listReviewTasks(r.id));
        const counts = countByStatus(tasks);
        return { review: r, tasks, counts };
      }),
    );

    const taskCounts = countByStatus(prdTasks);

    if (output.isJson()) {
      output.success({
        prd,
        tasks: { total: prdTasks.length, byStatus: taskCounts },
        reviews: reviewSummaries.map(({ review, tasks, counts }) => ({
          id: review.id,
          type: review.type,
          status: review.status,
          taskCount: tasks.length,
          byStatus: counts,
        })),
      });
      return;
    }

    output.print(`PRD ${prd.id}`);
    output.fields([
      ["Title", prd.title],
      ["Status", `${prd.status} (rev ${prd.revision})`],
      ["Activated", prd.activatedAt ? formatDateWithRelative(prd.activatedAt) : null],
      ["Ready", prd.readyAt ? formatDateWithRelative(prd.readyAt) : null],
      ["Phase", prd.currentPhase ?? null],
    ]);

    output.print("");
    const tasksDone = (taskCounts.done ?? 0) + (taskCounts.skipped ?? 0);
    output.print(
      `Tasks (PRD): ${tasksDone}/${prdTasks.length} done — ${formatStatusCounts(taskCounts)}`,
    );

    if (reviewSummaries.length > 0) {
      output.print("");
      output.print(`Reviews: ${reviewSummaries.length}`);
      for (const { review, tasks, counts } of reviewSummaries) {
        const sym = review.status === "done" ? "✓" : " ";
        output.print(
          `  [${sym}] ${review.id} [${review.type}] [${review.status}] ${tasks.length} finding(s) — ${formatStatusCounts(counts)}`,
        );
      }
    }

    const openReviews = reviewSummaries.filter(
      ({ review, tasks }) =>
        review.status !== "done" &&
        tasks.length > 0 &&
        tasks.every((t) => t.status === "done" || t.status === "skipped" || t.status === "blocked"),
    );
    if (openReviews.length > 0) {
      output.print("");
      output.print("Action needed:");
      for (const { review } of openReviews) {
        output.print(
          `  - review ${review.id} has all tasks terminal — close it with \`depot review done ${review.id}\``,
        );
      }
    }
  },
});

function countByStatus<T extends { status: string }>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.status] = (out[item.status] ?? 0) + 1;
  }
  return out;
}

function formatStatusCounts(counts: Record<string, number>): string {
  const order = ["done", "in_progress", "pending", "blocked", "skipped"];
  const parts: string[] = [];
  for (const s of order) {
    if (counts[s]) parts.push(`${counts[s]} ${s}`);
  }
  for (const [s, n] of Object.entries(counts)) {
    if (!order.includes(s)) parts.push(`${n} ${s}`);
  }
  return parts.length > 0 ? parts.join(", ") : "no tasks";
}

// ── findingsCommand ───────────────────────────────────────────────────────────

const findingsCommand = command({
  meta: {
    name: "findings",
    description: "Aggregate review findings across all reviews for a PRD",
  },
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
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    const reviewList = await runEffect(DomainReviews.listReviews(prd.id));
    const allFindings: Array<{
      review: (typeof reviewList)[number];
      task: import("#/db/schema").TaskRow;
    }> = [];
    for (const r of reviewList) {
      const tasks = await runEffect(DomainReviews.listReviewTasks(r.id));
      for (const t of tasks) allFindings.push({ review: r, task: t });
    }

    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, { total: number; byStatus: Record<string, number> }> = {};
    for (const { task } of allFindings) {
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      const sev = task.severity ?? "unspecified";
      bySeverity[sev] ??= { total: 0, byStatus: {} };
      bySeverity[sev].total++;
      bySeverity[sev].byStatus[task.status] = (bySeverity[sev].byStatus[task.status] ?? 0) + 1;
    }

    const open = allFindings.filter(
      ({ task }) => task.status === "pending" || task.status === "in_progress",
    );
    const blocking = allFindings.filter(({ task }) => task.status === "blocked");

    if (output.isJson()) {
      output.success({
        prd: { id: prd.id, title: prd.title, status: prd.status },
        reviews: reviewList.length,
        total: allFindings.length,
        byStatus,
        bySeverity,
        open: open.length,
        blocking: blocking.length,
      });
      return;
    }

    output.print(`PRD ${prd.id} [${prd.status}]`);
    output.print(`  Reviews: ${reviewList.length}`);
    output.print(`  Total findings: ${allFindings.length}`);
    if (allFindings.length > 0) {
      output.print(``);
      output.print(`  By status:`);
      for (const [s, n] of Object.entries(byStatus)) output.print(`    ${s}: ${n}`);
      output.print(``);
      output.print(`  By severity:`);
      const severityOrder = ["critical", "major", "minor", "info", "unspecified"];
      for (const sev of severityOrder) {
        const data = bySeverity[sev];
        if (!data) continue;
        const breakdown = Object.entries(data.byStatus)
          .map(([s, n]) => `${n} ${s}`)
          .join(", ");
        output.print(`    ${sev.padEnd(11)} ${data.total} (${breakdown})`);
      }
    }
    output.print(``);
    output.print(`  Open findings (actionable): ${open.length}`);
    output.print(`  Blocking findings:          ${blocking.length}`);
  },
});

// ── closeCommand ──────────────────────────────────────────────────────────────

const closeCommand = command({
  meta: {
    name: "close",
    description:
      "Activate then mark a ready PRD as done in one step (skips activation if already in_progress)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    approvedBy: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Name of the approver",
    },
    comment: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Approval comment",
    },
    userConfirmed: userConfirmedArg,
  },
  run: async ({ args, ws, output }) => {
    // `close` walks the activate → request-review → done chain with a single
    // user confirmation. The same literal quote is attached to all three
    // activity_log events so the audit trail shows the wrapper as one unit.
    const userConfirmation = requireUserConfirmation(args, "depot prd close", output);
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    let activated = prd;
    if (prd.status === "ready") {
      const a = await runEffect(
        DomainPrds.activatePrd(prd.id, ws.id).pipe(
          Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
        ),
      );
      if (!a) return output.error("not_found", `PRD not found: ${args.prdId}`);
      activated = a;
      await attachUserConfirmationToLatestActivity(activated.id, "prd_activated", userConfirmation);
    } else if (prd.status !== "in_progress") {
      return output.error(
        "invalid_status",
        `Cannot close PRD '${prd.title}' (status: '${prd.status}'). Only ready or in_progress PRDs can be closed.`,
      );
    }

    // `donePrd` only accepts `review` as source now (the human-review gate
    // is mandatory). `close` is the convenience wrapper that walks the whole
    // path — activate (if needed) → request-review → done — in one shot so
    // that small wrap-up PRDs don't have to spell out every transition.
    if (activated.status === "in_progress") {
      const reviewed = await runEffect(
        DomainPrds.requestReviewPrd(activated.id).pipe(
          Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
        ),
      );
      if (!reviewed) return output.error("not_found", `PRD not found: ${args.prdId}`);
      activated = reviewed;
      await attachUserConfirmationToLatestActivity(
        activated.id,
        "prd_review_requested",
        userConfirmation,
      );
    }

    const updated = await runEffect(
      DomainPrds.donePrd(activated.id).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);

    await attachUserConfirmationToLatestActivity(updated.id, "prd_done", userConfirmation);

    if (args.approvedBy || args.comment) {
      await runEffect(
        logActivity({
          projectId: updated.projectId,
          workspaceId: updated.workspaceId ?? undefined,
          prdRevisionId: updated.id,
          eventType: "prd_approved",
          payload: {
            prdRevisionId: updated.id,
            approvedBy: args.approvedBy ?? null,
            comment: args.comment ?? null,
            approvedAt: new Date().toISOString(),
          },
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }

    if (output.isJson()) {
      output.success({
        item: updated,
        approvedBy: args.approvedBy ?? null,
        comment: args.comment ?? null,
      });
    } else {
      output.print(`Closed PRD '${updated.title}' (${updated.id})`);
      if (args.approvedBy) output.print(`  Approved by: ${args.approvedBy}`);
      if (args.comment) output.print(`  Comment    : ${args.comment}`);
    }
  },
});

// ── discardCommand (alias of cancel for drafts) ───────────────────────────────

const discardCommand = command({
  meta: {
    name: "discard",
    description: "Discard (cancel) a draft PRD — convenience alias for `prd cancel`",
  },
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
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    if (prd.status !== "draft") {
      return output.error(
        "invalid_status",
        `'discard' only applies to draft PRDs. PRD '${prd.title}' is '${prd.status}' — use \`depot prd cancel\` instead.`,
      );
    }
    const updated = await runEffect(
      DomainPrds.cancelPrd(prd.id).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Discarded draft PRD '${updated.title}' (${updated.id})`);
    }
  },
});

// ── PRD sections ──────────────────────────────────────────────────────────────

const sectionsCommand = command({
  meta: {
    name: "sections",
    description: "Update structured PRD sections (problem, solution, decisions)",
  },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    problem: { schema: Schema.String, description: "Problem statement" },
    solution: { schema: Schema.String, description: "Chosen solution / approach summary" },
    implementationDecisions: {
      schema: Schema.String,
      description: "Key implementation decisions",
    },
    testingDecisions: { schema: Schema.String, description: "How the work will be tested" },
  },
  run: async ({ args, output }) => {
    const changes: {
      problem?: string;
      solution?: string;
      implementationDecisions?: string;
      testingDecisions?: string;
    } = {};
    if (args.problem !== undefined) changes.problem = args.problem;
    if (args.solution !== undefined) changes.solution = args.solution;
    if (args.implementationDecisions !== undefined)
      changes.implementationDecisions = args.implementationDecisions;
    if (args.testingDecisions !== undefined) changes.testingDecisions = args.testingDecisions;
    if (Object.keys(changes).length === 0) {
      return output.error(
        "no_changes",
        "No changes provided. Use --problem, --solution, --implementation-decisions, or --testing-decisions.",
      );
    }
    const updated = await runEffect(DomainPrds.updatePrdSections(args.prdId, changes));
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Updated PRD '${updated.title}' (${updated.id}) sections.`);
  },
});

// ── User stories ──────────────────────────────────────────────────────────────

const storyAddCommand = command({
  meta: { name: "add", description: "Add a user story to a PRD" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    asRole: { schema: Schema.String.pipe(Schema.minLength(1)), required: true, alias: "a" },
    want: { schema: Schema.String.pipe(Schema.minLength(1)), required: true, alias: "w" },
    so: { schema: Schema.String.pipe(Schema.minLength(1)), required: true, alias: "s" },
    notes: { schema: Schema.String, alias: "n" },
  },
  run: async ({ args, output }) => {
    const story = await runEffect(
      DomainStories.createUserStory({
        prdRevisionId: args.prdId,
        asRole: args.asRole,
        want: args.want,
        so: args.so,
        notes: args.notes,
      }),
    );
    if (output.isJson()) output.success({ item: story });
    else
      output.print(
        `Created user story ${story.id} (#${story.position}): as ${story.asRole}, I want ${story.want}, so ${story.so}`,
      );
  },
});

const storyListCommand = command({
  meta: { name: "list", description: "List user stories for a PRD" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
  },
  run: async ({ args, output }) => {
    const stories = await runEffect(DomainStories.listUserStories(args.prdId));
    if (output.isJson()) {
      output.success({ items: stories });
      return;
    }
    if (stories.length === 0) {
      output.print("No user stories.");
      return;
    }
    for (const s of stories) {
      output.print(`#${s.position} ${s.id}  As ${s.asRole}, I want ${s.want}, so ${s.so}`);
    }
  },
});

const storyUpdateCommand = command({
  meta: { name: "update", description: "Update a user story" },
  args: {
    storyId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Story ID",
    },
    asRole: { schema: Schema.String, alias: "a" },
    want: { schema: Schema.String, alias: "w" },
    so: { schema: Schema.String, alias: "s" },
    notes: { schema: Schema.String, alias: "n" },
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainStories.updateUserStory(args.storyId, {
        asRole: args.asRole,
        want: args.want,
        so: args.so,
        notes: args.notes,
      }),
    );
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Updated user story ${updated.id}`);
  },
});

const storyRemoveCommand = command({
  meta: { name: "remove", description: "Remove a user story" },
  args: {
    storyId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Story ID",
    },
  },
  run: async ({ args, output }) => {
    await runEffect(DomainStories.removeUserStory(args.storyId));
    if (output.isJson()) output.success({ id: args.storyId });
    else output.print(`Removed user story ${args.storyId}`);
  },
});

const storyLinkCommand = command({
  meta: { name: "link", description: "Link a story to a task" },
  args: {
    storyId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Story ID",
    },
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, output }) => {
    const link = await runEffect(DomainStories.linkStoryToTask(args.storyId, args.taskId));
    if (output.isJson()) output.success({ item: link });
    else output.print(`Linked story ${args.storyId} ↔ task ${args.taskId}`);
  },
});

const storyUnlinkCommand = command({
  meta: { name: "unlink", description: "Unlink a story from a task" },
  args: {
    storyId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Story ID",
    },
    taskId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Task ID",
    },
  },
  run: async ({ args, output }) => {
    await runEffect(DomainStories.unlinkStoryFromTask(args.storyId, args.taskId));
    if (output.isJson()) output.success({ storyId: args.storyId, taskId: args.taskId });
    else output.print(`Unlinked story ${args.storyId} ↔ task ${args.taskId}`);
  },
});

const storyCommand = command({
  meta: { name: "story", description: "User story management for a PRD" },
  subCommands: {
    add: storyAddCommand,
    list: storyListCommand,
    update: storyUpdateCommand,
    remove: storyRemoveCommand,
    link: storyLinkCommand,
    unlink: storyUnlinkCommand,
  },
});

// ── PRD repos ─────────────────────────────────────────────────────────────────

const repoAddCommand = command({
  meta: { name: "add", description: "Add a project repo to the PRD's repo scope" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    repoName: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Registered project_repo name",
    },
  },
  run: async ({ args, output }) => {
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const repo = await runEffect(DomainRepos.getRepo(prd.projectId, args.repoName));
    if (!repo) {
      return output.error(
        "not_found",
        `Repo '${args.repoName}' is not registered for project ${prd.projectId}.`,
      );
    }
    const link = await runEffect(DomainPrdRepos.addPrdRepo(prd.id, repo.id));
    if (output.isJson()) {
      output.success({ item: link, repo: { id: repo.id, name: repo.name } });
    } else {
      output.print(`Added repo '${repo.name}' to PRD ${prd.id}`);
    }
  },
});

const repoRemoveCommand = command({
  meta: { name: "remove", description: "Remove a project repo from the PRD's repo scope" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    repoName: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Registered project_repo name",
    },
  },
  run: async ({ args, output }) => {
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const repo = await runEffect(DomainRepos.getRepo(prd.projectId, args.repoName));
    if (!repo) {
      return output.error(
        "not_found",
        `Repo '${args.repoName}' is not registered for project ${prd.projectId}.`,
      );
    }
    await runEffect(DomainPrdRepos.removePrdRepo(prd.id, repo.id));
    if (output.isJson()) {
      output.success({ prdId: prd.id, repo: { id: repo.id, name: repo.name } });
    } else {
      output.print(`Removed repo '${repo.name}' from PRD ${prd.id}`);
    }
  },
});

const repoListCommand = command({
  meta: { name: "list", description: "List repos in the PRD's repo scope" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
  },
  run: async ({ args, output }) => {
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
    const links = await runEffect(DomainPrdRepos.listPrdRepos(prd.id));
    const repos = await runEffect(DomainRepos.listRepos(prd.projectId));
    const repoById = new Map(repos.map((r) => [r.id, r]));
    const items = links.map((link) => {
      const repo = repoById.get(link.repoId);
      return {
        id: link.id,
        prdRevisionId: link.prdRevisionId,
        repoId: link.repoId,
        repoName: repo?.name ?? null,
        repoPath: repo?.path ?? null,
        createdAt: link.createdAt,
      };
    });
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No repos declared for this PRD.");
      return;
    }
    for (const item of items) {
      output.print(`${item.repoName ?? "(unknown)"}  ${item.repoId}`);
    }
  },
});

const reposCommand = command({
  meta: { name: "repos", description: "Manage the PRD's repo scope" },
  subCommands: {
    add: repoAddCommand,
    remove: repoRemoveCommand,
    list: repoListCommand,
  },
});

// ── PRD tags ──────────────────────────────────────────────────────────────────
//
// Tags are free-form kebab-case labels attached to a logical PRD. Three
// subcommands plus the `prd list --tag` filter cover the full surface; tag
// add/remove emit `prd_tag_added` / `prd_tag_removed` activity events so the
// audit log captures who tagged what. Source defaults to `human` (the CLI
// caller is the user) because tags are organisational metadata, not a
// lifecycle transition that needs `--user-confirmed`.

const tagAddCommand = command({
  meta: { name: "add", description: "Attach a tag to a PRD (idempotent)" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    tag: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Tag to attach (kebab-case, max 50 chars)",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainPrdTags.addTag(args.prdId, args.tag).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }
    const row = result.item;
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_tag_added",
          payload: { prdId: row.prdId, tag: row.tag },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) {
      output.success({ item: row });
    } else {
      output.print(`Tagged PRD ${args.prdId} with '${row.tag}'`);
    }
  },
});

const tagRemoveCommand = command({
  meta: { name: "remove", description: "Detach a tag from a PRD (idempotent)" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    tag: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Tag to detach",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainPrdTags.removeTag(args.prdId, args.tag).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_tag_removed",
          payload: { prdId: result.item.prdId, tag: args.tag },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) {
      output.success({ prdId: result.item.prdId, tag: args.tag });
    } else {
      output.print(`Removed tag '${args.tag}' from PRD ${args.prdId}`);
    }
  },
});

const tagListCommand = command({
  meta: {
    name: "list",
    description:
      "List tags — without an ID, every tag used in the project; with an ID, that PRD's tags",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      positional: true,
      description: "PRD ID (optional)",
    },
  },
  run: async ({ args, ws, output }) => {
    if (args.prdId) {
      const result = await runEffect(
        DomainPrdTags.listTagsForPrd(args.prdId).pipe(
          Effect.match({
            onSuccess: (items) => ({ kind: "ok" as const, items }),
            onFailure: (err) => ({ kind: "err" as const, err }),
          }),
        ),
      );
      if (result.kind === "err") {
        const e = result.err;
        if (e._tag === "PrdNotFoundError") {
          return output.error("not_found", `PRD not found: ${args.prdId}`);
        }
        throw e;
      }
      if (output.isJson()) {
        output.success({ items: result.items });
        return;
      }
      if (result.items.length === 0) {
        output.print("No tags.");
        return;
      }
      for (const tag of result.items) output.print(tag);
      return;
    }
    const tags = await runEffect(DomainPrdTags.listAllTagsForProject(ws.projectId));
    if (output.isJson()) {
      output.success({ items: tags });
      return;
    }
    if (tags.length === 0) {
      output.print("No tags in this project.");
      return;
    }
    for (const tag of tags) output.print(tag);
  },
});

const tagCommand = command({
  meta: { name: "tag", description: "Manage tags on a PRD" },
  subCommands: {
    add: tagAddCommand,
    remove: tagRemoveCommand,
    list: tagListCommand,
  },
});

// ── PRD annexes ───────────────────────────────────────────────────────────────
//
// Annexes are named text artifacts (HTML prototypes, data samples, …) attached
// to a PRD *revision*. The `add/list/cat/rm` subtree mirrors the `tag` subtree's
// shape. Source defaults to `human` and there is no `--user-confirmed`: an annex
// is content, not a lifecycle transition. The content body comes from one of
// `--file`, `--content`, or stdin (in that precedence).

const annexAddCommand = command({
  meta: {
    name: "add",
    description: "Attach a text annex to a PRD revision (from --file, --content, or stdin)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID (revision ID)",
    },
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Annex name (kebab-case slug, unique per revision, max 60 chars)",
    },
    kind: {
      schema: Schema.Literal(...VALID_ANNEX_KINDS),
      required: true,
      expected: `one of ${VALID_ANNEX_KINDS.join(", ")}`,
      description: "Render hint (html|markdown|code|text)",
    },
    description: {
      schema: Schema.String,
      alias: "d",
      description: "Free-form relevance summary (max 500 chars)",
    },
    file: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "f",
      description: "Read annex content from a UTF-8 text file",
    },
    content: {
      schema: Schema.String,
      description: "Inline annex content",
    },
    replace: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Overwrite an existing annex of the same name instead of failing",
    },
  },
  run: async ({ args, output }) => {
    if (args.file !== undefined && args.content !== undefined) {
      return output.error("conflicting_input", "Provide either --file or --content, not both.");
    }

    let content: string;
    if (args.file !== undefined) {
      try {
        content = await readFile(args.file, "utf-8");
      } catch (e) {
        return output.error(
          "file_read_error",
          `Cannot read file '${args.file}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else if (args.content !== undefined) {
      content = args.content;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      content = Buffer.concat(chunks).toString("utf-8");
    }

    const result = await runEffect(
      DomainAnnexes.addAnnex(args.prdId, {
        name: args.name,
        kind: args.kind,
        description: args.description,
        content,
        replace: args.replace,
      }).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "AnnexExistsError") {
        return output.error("annex_exists", e.message);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }

    const row = result.item;
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_annex_added",
          payload: { annexId: row.id, name: row.name, kind: row.kind },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }

    if (output.isJson()) {
      output.success({ item: row });
    } else {
      output.print(`Added annex '${row.name}' (${row.kind}) to PRD ${args.prdId} — ${row.id}`);
    }
  },
});

const annexListCommand = command({
  meta: { name: "list", description: "List a PRD revision's annexes (name, kind, description)" },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID (revision ID)",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainAnnexes.listAnnexes(args.prdId).pipe(
        Effect.match({
          onSuccess: (items) => ({ kind: "ok" as const, items }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      throw e;
    }
    if (output.isJson()) {
      output.success({ items: result.items });
      return;
    }
    if (result.items.length === 0) {
      output.print("No annexes on this PRD.");
      return;
    }
    for (const annex of result.items) {
      const desc = annex.description ? ` — ${annex.description}` : "";
      output.print(`${annex.id}  ${annex.name} (${annex.kind})${desc}`);
    }
  },
});

const annexCatCommand = command({
  meta: { name: "cat", description: "Print an annex's full content to stdout" },
  workspace: true,
  args: {
    annexId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Annex ID",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainAnnexes.getAnnex(args.annexId).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "AnnexNotFoundError") {
        return output.error("not_found", `Annex not found: ${args.annexId}`);
      }
      throw e;
    }
    if (output.isJson()) {
      output.success({ item: result.item });
      return;
    }
    output.print(result.item.content);
  },
});

const annexRmCommand = command({
  meta: { name: "rm", description: "Remove an annex by ID" },
  workspace: true,
  args: {
    annexId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Annex ID",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainAnnexes.removeAnnex(args.annexId).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "AnnexNotFoundError") {
        return output.error("not_found", `Annex not found: ${args.annexId}`);
      }
      throw e;
    }
    const row = result.item;
    const prd = await runEffect(DomainPrds.getPrd(row.prdRevisionId));
    if (prd) {
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType: "prd_annex_removed",
          payload: { annexId: row.id, name: row.name, kind: row.kind },
          source: "human",
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }
    if (output.isJson()) {
      output.success({ annexId: row.id, name: row.name });
    } else {
      output.print(`Removed annex '${row.name}' (${row.id}) from PRD ${row.prdRevisionId}`);
    }
  },
});

const annexCommand = command({
  meta: { name: "annex", description: "Manage text annexes on a PRD revision" },
  subCommands: {
    add: annexAddCommand,
    list: annexListCommand,
    cat: annexCatCommand,
    rm: annexRmCommand,
  },
});

// ── Out-of-scope items ────────────────────────────────────────────────────────

const oosAddCommand = command({
  meta: { name: "add", description: "Record a deliberate out-of-scope decision" },
  workspace: true,
  args: {
    title: { schema: Schema.String.pipe(Schema.minLength(1)), required: true, alias: "t" },
    reason: { schema: Schema.String.pipe(Schema.minLength(1)), required: true, alias: "r" },
    prdId: { schema: Schema.String.pipe(Schema.minLength(1)), alias: "p" },
    decidedBy: { schema: Schema.String, alias: "b" },
  },
  run: async ({ args, ws, output }) => {
    const item = await runEffect(
      DomainOutOfScope.addOutOfScope({
        projectId: ws.projectId,
        prdRevisionId: args.prdId,
        title: args.title,
        reason: args.reason,
        decidedBy: args.decidedBy,
      }),
    );
    if (output.isJson()) output.success({ item });
    else output.print(`Recorded out-of-scope: '${item.title}' (${item.id})`);
  },
});

const oosListCommand = command({
  meta: { name: "list", description: "List out-of-scope items" },
  workspace: true,
  args: {
    prdId: { schema: Schema.String.pipe(Schema.minLength(1)), alias: "p" },
  },
  run: async ({ args, ws, output }) => {
    const items = await runEffect(
      DomainOutOfScope.listOutOfScope({
        projectId: ws.projectId,
        prdRevisionId: args.prdId,
      }),
    );
    if (output.isJson()) {
      output.success({ items });
      return;
    }
    if (items.length === 0) {
      output.print("No out-of-scope items.");
      return;
    }
    for (const i of items) {
      const scope = i.prdRevisionId ? `PRD ${i.prdRevisionId}` : "project-wide";
      output.print(`${i.id}  [${scope}]  ${i.title} — ${i.reason}`);
    }
  },
});

const oosRemoveCommand = command({
  meta: { name: "remove", description: "Remove an out-of-scope item" },
  args: {
    id: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Out-of-scope item ID",
    },
  },
  run: async ({ args, output }) => {
    await runEffect(DomainOutOfScope.removeOutOfScope(args.id));
    if (output.isJson()) output.success({ id: args.id });
    else output.print(`Removed out-of-scope item ${args.id}`);
  },
});

const outOfScopeCommand = command({
  meta: { name: "out-of-scope", description: "Out-of-scope items" },
  subCommands: { add: oosAddCommand, list: oosListCommand, remove: oosRemoveCommand },
});

// ── Priority subcommands (PRD 0019 / T5) ──────────────────────────────────────
//
// `depot prd priority set <prd-id> <critical|high|normal|low>` writes the
// product priority onto the logical PRD; `unset` reverts to the default
// `normal`. Source defaults to `human` (the CLI caller is the user) because
// priority is organisational metadata, not a lifecycle transition that needs
// `--user-confirmed`.

const prioritySetCommand = command({
  meta: {
    name: "set",
    description: "Set the product priority on a PRD (critical|high|normal|low)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    priority: {
      schema: Schema.Literal(...VALID_PRD_PRIORITIES),
      expected: `one of ${VALID_PRD_PRIORITIES.join(", ")}`,
      required: true,
      positional: true,
      description: "Product priority",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainPriority.setPriority(args.prdId, args.priority).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }
    const { prd, changed, previousPriority, newPriority } = result.item;
    if (output.isJson()) {
      output.success({ item: prd, changed, previousPriority, newPriority });
    } else if (!changed) {
      output.print(`Priority unchanged for PRD ${args.prdId} (already '${newPriority}').`);
    } else {
      output.print(
        `Updated priority on PRD ${args.prdId}: '${previousPriority}' -> '${newPriority}'`,
      );
    }
  },
});

const priorityUnsetCommand = command({
  meta: {
    name: "unset",
    description: "Reset the product priority on a PRD back to 'normal'",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainPriority.unsetPriority(args.prdId).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      throw e;
    }
    const { prd, changed, previousPriority, newPriority } = result.item;
    if (output.isJson()) {
      output.success({ item: prd, changed, previousPriority, newPriority });
    } else if (!changed) {
      output.print(`Priority already 'normal' on PRD ${args.prdId}.`);
    } else {
      output.print(`Reset priority on PRD ${args.prdId}: '${previousPriority}' -> 'normal'`);
    }
  },
});

const priorityCommand = command({
  meta: { name: "priority", description: "Product priority management for PRDs" },
  subCommands: {
    set: prioritySetCommand,
    unset: priorityUnsetCommand,
  },
});

// ── Milestone (target_version) subcommands ────────────────────────────────────

const milestoneSetCommand = command({
  meta: {
    name: "set",
    description: "Set the milestone / target_version on a PRD (free-form text)",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    version: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Milestone / target version (e.g. 2.6, 2.7-alpha, agent-polish)",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainMilestones.setMilestone(args.prdId, args.version).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }
    const { prd, changed, previousVersion, newVersion } = result.item;
    if (output.isJson()) {
      output.success({ item: prd, changed, previousVersion, newVersion });
    } else if (!changed) {
      output.print(`Milestone unchanged for PRD ${args.prdId} (already '${newVersion}').`);
    } else if (previousVersion === null) {
      output.print(`Set milestone '${newVersion}' on PRD ${args.prdId}`);
    } else {
      output.print(
        `Updated milestone on PRD ${args.prdId}: '${previousVersion}' -> '${newVersion}'`,
      );
    }
  },
});

const milestoneUnsetCommand = command({
  meta: {
    name: "unset",
    description: "Clear the milestone / target_version on a PRD",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainMilestones.unsetMilestone(args.prdId).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${args.prdId}`);
      }
      throw e;
    }
    const { prd, changed, previousVersion } = result.item;
    if (output.isJson()) {
      output.success({ item: prd, changed, previousVersion });
    } else if (!changed) {
      output.print(`Milestone already unset on PRD ${args.prdId}.`);
    } else {
      output.print(`Cleared milestone on PRD ${args.prdId} (was '${previousVersion ?? ""}')`);
    }
  },
});

const milestoneListCommand = command({
  meta: {
    name: "list",
    description: "List PRDs in the current project that target the given milestone",
  },
  workspace: true,
  args: {
    version: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Milestone / target version",
    },
  },
  run: async ({ args, ws, output }) => {
    const items = await runEffect(DomainMilestones.listPrdsByMilestone(ws.projectId, args.version));
    if (output.isJson()) {
      output.success({ items, version: args.version });
      return;
    }
    if (items.length === 0) {
      output.print(`No PRDs target milestone '${args.version}'.`);
      return;
    }
    for (const p of items) {
      output.print(`${p.id}  ${p.title}  [${p.status}]  rev ${p.revision}`);
    }
  },
});

const milestoneSummaryCommand = command({
  meta: {
    name: "summary",
    description: "Summarise PRDs of a milestone by status (count per status)",
  },
  workspace: true,
  args: {
    version: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Milestone / target version",
    },
  },
  run: async ({ args, ws, output }) => {
    const summary = await runEffect(
      DomainMilestones.summaryByMilestone(ws.projectId, args.version),
    );
    if (output.isJson()) {
      output.success(summary);
      return;
    }
    output.print(`Milestone '${summary.version}': ${summary.total} PRD(s)`);
    const order = ["draft", "ready", "in_progress", "review", "done", "canceled"] as const;
    for (const status of order) {
      output.print(`  ${status.padEnd(12)} ${summary.byStatus[status] ?? 0}`);
    }
  },
});

const milestoneCommand = command({
  meta: { name: "milestone", description: "Milestone / target_version management for PRDs" },
  subCommands: {
    set: milestoneSetCommand,
    unset: milestoneUnsetCommand,
    list: milestoneListCommand,
    summary: milestoneSummaryCommand,
  },
});

const commitMessageCommand = command({
  meta: {
    name: "commit-message",
    description: "Persist the suggested commit message for the whole PRD",
  },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    message: { schema: Schema.String.pipe(Schema.minLength(1)), required: true },
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.updateSuggestedCommitMessage(args.prdId, args.message),
    );
    if (output.isJson()) output.success({ item: updated });
    else output.print(`Saved suggested commit message for PRD ${args.prdId}.`);
  },
});

// ── Pre-X checks ──────────────────────────────────────────────────────────────

// Wrapper command shared by every `prd <hook>-check` CLI entry point. Each
// wrapper runs the blocking `kind=command` directives matching a given scope
// for the PRD across every repo it targets, then emits a single high-level
// activity event aggregating the run. Per-directive `directive_run` events are
// emitted inside `runDirective` itself.
const buildCheckCommand = (
  commandName: string,
  scope:
    | "pre-review"
    | "pre-ship"
    | "pre-coder-spawn"
    | "post-auditor-pass"
    | "pre-handoff"
    | "pre-phase-advance",
  description: string,
  eventType:
    | "pre_review_check"
    | "pre_ship_check"
    | "pre_coder_check"
    | "post_auditor_check"
    | "pre_handoff_check"
    | "pre_phase_advance_check",
) =>
  command({
    meta: { name: commandName, description },
    workspace: true,
    args: {
      prdId: {
        schema: Schema.String.pipe(Schema.minLength(1)),
        required: true,
        positional: true,
        description: "PRD ID",
      },
    },
    run: async ({ args, ws, output }) => {
      const prd = await runEffect(DomainPrds.getPrd(args.prdId));
      if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);
      const result = await runEffect(
        DomainDirectives.runScopeBlockingForPrd(prd.id, scope, {
          wsPath: ws.path,
          source: "human",
        }),
      );
      // Surface the first failing directive across repos for the pre-check log
      // event (kept single per command run, not per repo).
      const failingDirectiveId = result.perRepo.find((r) => !r.ok)?.failingDirectiveId;
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType,
          payload: {
            prdRevisionId: prd.id,
            ok: result.ok,
            failingDirectiveId,
          },
        }),
      );
      if (output.isJson()) {
        output.success(result);
      } else {
        const repoCount = result.perRepo.length;
        const multi = repoCount > 1;
        const directiveCount = result.perRepo[0]?.results.length ?? 0;
        if (multi) {
          output.print(
            `Running ${directiveCount} ${scope} directive(s) for PRD ${prd.id} across ${repoCount} repo(s):`,
          );
        } else {
          output.print(`Running ${directiveCount} ${scope} directive(s) for PRD ${prd.id}:`);
        }
        for (const repoOutcome of result.perRepo) {
          if (multi) {
            const repoIcon = repoOutcome.ok ? "✓" : "✗";
            output.print(`  ${repoIcon} repo: ${repoOutcome.repoName}`);
          }
          const indent = multi ? "  " : "";
          for (const r of repoOutcome.results) {
            const icon = r.ok ? "✓" : "✗";
            output.print(
              `${indent}  ${icon} ${r.title} [repo: ${r.repoTarget}] — ${r.durationMs}ms`,
            );
            const trace = DomainDirectives.formatSelectionTrace(r.selection);
            if (trace) output.print(`${indent}    ${trace}`);
            if (r.noOp) {
              output.print(`${indent}    (no modified repo detected — skipped)`);
            }
            if (r.repoResults.length > 1) {
              for (const rr of r.repoResults) {
                const ricon = rr.ok ? "✓" : "✗";
                output.print(`${indent}    ${ricon} ${rr.repoName}`);
                if (!rr.ok && rr.stderr) {
                  for (const line of rr.stderr.split("\n").slice(0, 8)) {
                    output.print(`${indent}      | ${line}`);
                  }
                }
              }
            } else if (!r.ok && r.stderr) {
              for (const line of r.stderr.split("\n").slice(0, 10)) {
                output.print(`${indent}    | ${line}`);
              }
            }
          }
          if (!repoOutcome.ok) {
            output.print(`${indent}  Stopped at first blocking failure in this repo.`);
          }
        }
      }
      if (!result.ok) process.exitCode = 1;
    },
  });

const preReviewCheckCommand = buildCheckCommand(
  "pre-review-check",
  "pre-review",
  "Run blocking pre-review directives for a PRD",
  "pre_review_check",
);
const preShipCheckCommand = buildCheckCommand(
  "pre-ship-check",
  "pre-ship",
  "Run blocking pre-ship directives for a PRD",
  "pre_ship_check",
);
const preCoderCheckCommand = buildCheckCommand(
  "pre-coder-check",
  "pre-coder-spawn",
  "Run blocking pre-coder-spawn directives for a PRD",
  "pre_coder_check",
);
const postAuditorCheckCommand = buildCheckCommand(
  "post-auditor-check",
  "post-auditor-pass",
  "Run blocking post-auditor-pass directives for a PRD",
  "post_auditor_check",
);
const preHandoffCheckCommand = buildCheckCommand(
  "pre-handoff-check",
  "pre-handoff",
  "Run blocking pre-handoff directives for a PRD",
  "pre_handoff_check",
);
const prePhaseAdvanceCheckCommand = buildCheckCommand(
  "pre-phase-advance-check",
  "pre-phase-advance",
  "Run blocking pre-phase-advance directives for a PRD",
  "pre_phase_advance_check",
);

// ── PRD dependencies (DAG) ────────────────────────────────────────────────────
//
// Sub-tree `depot prd depend` (PRD 0019 / T2). Users supply either the logical
// `prds.id` or any revision id; the CLI resolves to the logical id before
// calling the domain layer so the stored edge survives forks.

async function resolveLogicalPrdId(
  id: string,
): Promise<{ logicalId: string; revision: import("#/db/schema").PrdRevisionRow | null }> {
  const rev = await runEffect(DomainPrds.getPrd(id));
  return { logicalId: rev?.prdId ?? id, revision: rev };
}

const dependAddCommand = command({
  meta: {
    name: "add",
    description: "Declare that <prd-id> depends on <depends-on-prd-id>",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Source PRD id (the one that depends on another)",
    },
    dependsOnPrdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Target PRD id (the dependency)",
    },
  },
  run: async ({ args, output }) => {
    const src = await resolveLogicalPrdId(args.prdId);
    const dst = await resolveLogicalPrdId(args.dependsOnPrdId);

    const result = await runEffect(
      DomainDependencies.addDependency(src.logicalId, dst.logicalId).pipe(
        Effect.match({
          onSuccess: (item) => ({ kind: "ok" as const, item }),
          onFailure: (err) => ({ kind: "err" as const, err }),
        }),
      ),
    );
    if (result.kind === "err") {
      const e = result.err;
      if (e._tag === "PrdNotFoundError") {
        return output.error("not_found", `PRD not found: ${e.id}`);
      }
      if (e._tag === "ValidationError") {
        return output.error("validation_error", e.message);
      }
      throw e;
    }

    await runEffect(
      logActivity({
        projectId: src.revision?.projectId ?? dst.revision?.projectId ?? "",
        workspaceId: src.revision?.workspaceId ?? undefined,
        prdRevisionId: src.revision?.id,
        eventType: "prd_depend_added",
        payload: { prdId: src.logicalId, dependsOnPrdId: dst.logicalId },
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
    );

    if (output.isJson()) {
      output.success({ item: result.item });
    } else {
      output.print(`Added dependency: ${src.logicalId} → ${dst.logicalId}`);
    }
  },
});

const dependRemoveCommand = command({
  meta: {
    name: "remove",
    description: "Drop the dependency from <prd-id> to <depends-on-prd-id>",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Source PRD id",
    },
    dependsOnPrdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Target PRD id (the dependency to drop)",
    },
  },
  run: async ({ args, output }) => {
    const src = await resolveLogicalPrdId(args.prdId);
    const dst = await resolveLogicalPrdId(args.dependsOnPrdId);

    await runEffect(DomainDependencies.removeDependency(src.logicalId, dst.logicalId));

    if (src.revision) {
      await runEffect(
        logActivity({
          projectId: src.revision.projectId,
          workspaceId: src.revision.workspaceId ?? undefined,
          prdRevisionId: src.revision.id,
          eventType: "prd_depend_removed",
          payload: { prdId: src.logicalId, dependsOnPrdId: dst.logicalId },
        }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
      );
    }

    if (output.isJson()) {
      output.success({ prdId: src.logicalId, dependsOnPrdId: dst.logicalId });
    } else {
      output.print(`Removed dependency: ${src.logicalId} → ${dst.logicalId}`);
    }
  },
});

const dependListCommand = command({
  meta: {
    name: "list",
    description: "Show what <prd-id> depends on and what depends on it",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD id",
    },
  },
  run: async ({ args, output }) => {
    const rev = await runEffect(DomainPrds.getPrd(args.prdId));
    const logicalId = rev?.prdId ?? args.prdId;
    const dependencies = await runEffect(DomainDependencies.listDependencies(logicalId));
    const dependents = await runEffect(DomainDependencies.listDependents(logicalId));

    const projectPrds = rev
      ? await runEffect(DomainPrds.listPrds({ projectId: rev.projectId, latestOnly: true }))
      : [];
    const headByPrdId = new Map(projectPrds.map((p) => [p.prdId, p]));
    const decorate = (logical: { id: string }) => {
      const head = headByPrdId.get(logical.id);
      return head
        ? { prdId: logical.id, headRevisionId: head.id, title: head.title, status: head.status }
        : { prdId: logical.id, headRevisionId: null, title: null, status: null };
    };

    const out = {
      prdId: logicalId,
      dependencies: dependencies.map(decorate),
      dependents: dependents.map(decorate),
    };

    if (output.isJson()) {
      output.success(out);
      return;
    }

    output.print(`PRD ${logicalId}`);
    output.print("");
    output.print(`Depends on (${out.dependencies.length}):`);
    if (out.dependencies.length === 0) {
      output.print("  (none)");
    } else {
      for (const d of out.dependencies) {
        const title = d.title ? ` — ${d.title}` : "";
        const status = d.status ? ` [${d.status}]` : "";
        output.print(`  - ${d.prdId}${title}${status}`);
      }
    }
    output.print("");
    output.print(`Depended on by (${out.dependents.length}):`);
    if (out.dependents.length === 0) {
      output.print("  (none)");
    } else {
      for (const d of out.dependents) {
        const title = d.title ? ` — ${d.title}` : "";
        const status = d.status ? ` [${d.status}]` : "";
        output.print(`  - ${d.prdId}${title}${status}`);
      }
    }
  },
});

const dependGraphCommand = command({
  meta: {
    name: "graph",
    description: "Render the project's PRD dependency DAG as ASCII text, grouped by status",
  },
  workspace: true,
  args: {},
  run: async ({ ws, output }) => {
    const graph = await runEffect(DomainDependencies.buildDependencyGraph(ws.projectId));
    const heads = await runEffect(
      DomainPrds.listPrds({ projectId: ws.projectId, latestOnly: true }),
    );
    const headByPrdId = new Map(heads.map((h) => [h.prdId, h]));

    const adj = new Map<string, string[]>();
    for (const e of graph.edges) {
      const list = adj.get(e.from) ?? [];
      list.push(e.to);
      adj.set(e.from, list);
    }

    if (output.isJson()) {
      output.success({
        nodes: graph.nodes.map((n) => {
          const head = headByPrdId.get(n.id);
          return {
            prdId: n.id,
            title: head?.title ?? null,
            status: head?.status ?? null,
          };
        }),
        edges: graph.edges,
      });
      return;
    }

    if (graph.nodes.length === 0) {
      output.print("No PRDs in this project.");
      return;
    }

    const statusOrder = ["in_progress", "review", "ready", "draft", "done", "canceled"];
    const byStatus = new Map<string, typeof graph.nodes>();
    for (const node of graph.nodes) {
      const head = headByPrdId.get(node.id);
      const status = head?.status ?? "unknown";
      const list = byStatus.get(status) ?? [];
      list.push(node);
      byStatus.set(status, list);
    }

    const seen = new Set<string>();
    const sortedStatuses = [
      ...statusOrder.filter((s) => byStatus.has(s)),
      ...[...byStatus.keys()].filter((s) => !statusOrder.includes(s)).sort(),
    ];

    for (const status of sortedStatuses) {
      const nodes = byStatus.get(status) ?? [];
      output.print(`[${status}]`);
      for (const node of nodes) {
        const head = headByPrdId.get(node.id);
        const title = head?.title ? ` — ${head.title}` : "";
        output.print(`  * ${node.id}${title}`);
        const deps = adj.get(node.id) ?? [];
        for (const dep of deps) {
          output.print(`    └─> ${dep}`);
          seen.add(dep);
        }
      }
      output.print("");
    }
  },
});

const dependCommand = command({
  meta: { name: "depend", description: "Manage PRD ↔ PRD dependency DAG" },
  subCommands: {
    add: dependAddCommand,
    remove: dependRemoveCommand,
    list: dependListCommand,
    graph: dependGraphCommand,
  },
});

export const prdCommand = command({
  meta: { name: "prd", description: "PRD management" },
  subCommands: {
    create: createCommand,
    show: showCommand,
    update: updateCommand,
    sections: sectionsCommand,
    list: listCommand,
    activate: activateCommand,
    ready: readyCommand,
    done: doneCommand,
    close: closeCommand,
    cancel: cancelCommand,
    discard: discardCommand,
    "request-review": requestReviewCommand,
    resume: resumeCommand,
    fork: forkCommand,
    load: loadCommand,
    reload: reloadCommand,
    validate: validateCommand,
    status: statusCommand,
    findings: findingsCommand,
    "phase-advance": phaseAdvanceCommand,
    phase: phaseCommand,
    milestone: milestoneCommand,
    priority: priorityCommand,
    "commit-message": commitMessageCommand,
    "pre-review-check": preReviewCheckCommand,
    "pre-ship-check": preShipCheckCommand,
    "pre-coder-check": preCoderCheckCommand,
    "post-auditor-check": postAuditorCheckCommand,
    "pre-handoff-check": preHandoffCheckCommand,
    "pre-phase-advance-check": prePhaseAdvanceCheckCommand,
    story: storyCommand,
    "out-of-scope": outOfScopeCommand,
    repos: reposCommand,
    tag: tagCommand,
    annex: annexCommand,
    depend: dependCommand,
  },
});
