import { Schema, Effect } from "effect";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { command } from "#/cli/command";
import { resolveTextInput } from "#/cli/file-input";
import { runEffect } from "#/cli/runtime";
import { captureSha, resolveGitRoot } from "#/lib/git";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
import * as DomainStories from "#/modules/prds/stories";
import * as DomainOutOfScope from "#/modules/prds/out-of-scope";
import * as DomainDirectives from "#/modules/projects/directives";
import * as DomainRepos from "#/modules/projects/repos";
import { logActivity } from "#/modules/activity/domain";
import { effortSchema } from "#/shared/schemas";
import { formatDate, formatDateWithRelative } from "#/shared/utils";
import { parseJsonSchema } from "#/lib/json";
import { VALID_PRD_STATUSES } from "#/shared/validator";

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
    const merges = await runEffect(DomainPrds.listMerges(args.prdId));
    if (output.isJson()) {
      output.success({ item: prd, merges });
    } else {
      output.fields([
        ["ID", prd.id],
        ["Title", prd.title],
        ["Status", prd.status],
        ["Revision", prd.revision],
        ["PRD", prd.prdId],
        ["Context", prd.context],
        ["Scope", prd.scope],
        ["Problem", prd.problem],
        ["Solution", prd.solution],
        ["Impl Decisions", prd.implementationDecisions],
        ["Testing Decisions", prd.testingDecisions],
        ["Activated SHA", prd.activatedAtSha],
        ["Done SHA", prd.doneAtSha],
        ["Merged SHA", prd.mergedAtSha],
        ["Worktree", prd.worktreePath],
        ["Created", formatDate(prd.createdAt)],
        ["Ready", formatDate(prd.readyAt)],
        ["Activated", prd.activatedAt ? formatDateWithRelative(prd.activatedAt) : "—"],
      ]);
      if (merges.length > 0) {
        output.print("");
        output.print("Merge anchors:");
        for (const m of merges) {
          output.print(`  ${m.repoName}  ${m.mergeSha}  ${formatDate(m.mergedAt)}`);
        }
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
      schema: Schema.Literal("created", "updated", "status"),
      expected: "one of created, updated, status",
      default: "updated",
      description: "Sort order",
    },
  },
  run: async ({ args, ws, output }) => {
    let prdList = await runEffect(
      DomainPrds.listPrds({ projectId: ws.projectId, latestOnly: true }),
    );

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

    const sortKey = args.sort ?? "updated";
    prdList = [...prdList].sort((a, b) => {
      if (sortKey === "status") return a.status.localeCompare(b.status);
      const aT = (sortKey === "created" ? a.createdAt : a.updatedAt)?.getTime() ?? 0;
      const bT = (sortKey === "created" ? b.createdAt : b.updatedAt)?.getTime() ?? 0;
      return bT - aT;
    });

    if (args.limit !== undefined) {
      prdList = prdList.slice(0, args.limit);
    }

    if (output.isJson()) {
      output.success({ items: prdList });
      return;
    }
    if (prdList.length === 0) {
      output.print("No PRDs found. Run `depot prd create` to create one.");
      return;
    }
    for (const p of prdList) {
      output.print(`${p.id}  ${p.title}  [${p.status}]  rev ${p.revision}`);
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
  },
  run: async ({ args, ws, output }) => {
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
          `Cannot activate PRD '${args.prdId}' from this workspace. ${e.message}. Use \`depot workspace list\` to find a workspace in the PRD's project, or run \`cd\` there before activating.`,
        );
      }
      throw e;
    }
    const activated = result.item;
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
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.markPrdReady(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
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
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.donePrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);

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
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.cancelPrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
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
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.requestReviewPrd(args.prdId, args.reason).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
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
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.resumePrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
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
  },
  run: async ({ args, output }) => {
    const result = await runEffect(
      DomainPrds.phaseAdvance(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!result) return output.error("not_found", `PRD not found: ${args.prdId}`);
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
  },
  run: async ({ args, ws, output }) => {
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
    }

    const updated = await runEffect(
      DomainPrds.donePrd(activated.id).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);

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

// ── Phase snapshot artifacts ──────────────────────────────────────────────────

const phaseBriefCommand = command({
  meta: { name: "phase-brief", description: "Persist the review brief for a phase" },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    phase: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      required: true,
      description: "Phase number",
    },
    content: { schema: Schema.String.pipe(Schema.minLength(1)), required: true },
  },
  run: async ({ args, output }) => {
    const snap = await runEffect(
      DomainPrds.upsertPhaseSnapshot(args.prdId, args.phase, { reviewBrief: args.content }),
    );
    if (output.isJson()) output.success({ item: snap });
    else output.print(`Saved review brief for PRD ${args.prdId} phase ${args.phase} (${snap.id}).`);
  },
});

// ── capture-merge ─────────────────────────────────────────────────────────────

type MergeRequest = {
  repoName?: string;
  sha?: string;
  fromCwd: boolean;
};

/**
 * Parse the `--repo` flag(s) into merge requests.
 *
 * Accepted shapes:
 * - no `--repo`, no `--sha`: bare capture (mono-repo HEAD or cwd-resolved)
 * - `--repo <name> --sha <sha>`: a single explicit repo+sha
 * - `--repo name1=sha1 --repo name2=sha2 ...`: multiple explicit repo+sha
 */
export function parseMergeRequests(
  repoArg: readonly string[] | string | undefined,
  shaArg: string | undefined,
): { ok: true; requests: MergeRequest[] } | { ok: false; message: string } {
  const repos = repoArg === undefined ? [] : Array.isArray(repoArg) ? [...repoArg] : [repoArg];

  if (repos.length === 0) {
    if (shaArg !== undefined) {
      return { ok: false, message: "--sha requires --repo <name> in a multi-repo project." };
    }
    return { ok: true, requests: [{ fromCwd: true }] };
  }

  const paired = repos.map((r) => r.includes("="));
  const allPaired = paired.every(Boolean);
  const nonePaired = paired.every((p) => !p);

  if (allPaired) {
    if (shaArg !== undefined) {
      return {
        ok: false,
        message: "Do not combine --sha with `--repo name=sha` pairs; pass the SHA inline.",
      };
    }
    const requests: MergeRequest[] = [];
    for (const entry of repos) {
      const eq = entry.indexOf("=");
      const name = entry.slice(0, eq).trim();
      const sha = entry.slice(eq + 1).trim();
      if (!name || !sha) {
        return { ok: false, message: `Invalid --repo pair '${entry}'. Expected <name>=<sha>.` };
      }
      requests.push({ repoName: name, sha, fromCwd: false });
    }
    return { ok: true, requests };
  }

  if (nonePaired) {
    if (repos.length > 1) {
      return {
        ok: false,
        message:
          "Multiple --repo flags require the `--repo name=sha` form. Pass each repo's SHA inline.",
      };
    }
    if (shaArg === undefined) {
      return {
        ok: false,
        message: `--repo ${repos[0]} requires --sha <sha> (or use --repo ${repos[0]}=<sha>).`,
      };
    }
    return { ok: true, requests: [{ repoName: repos[0], sha: shaArg, fromCwd: false }] };
  }

  return {
    ok: false,
    message: "Do not mix `--repo name=sha` pairs with a bare `--repo name`.",
  };
}

const captureMergeCommand = command({
  meta: {
    name: "capture-merge",
    description:
      "Anchor post-merge SHA(s) on the base branch — recovers the diff after a squash merge.",
  },
  workspace: true,
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD ID",
    },
    repo: {
      schema: Schema.Union(Schema.String, Schema.Array(Schema.String)),
      description: "Repo name, or `name=sha` pair (repeatable for multi-repo)",
    },
    sha: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      description: "Merge commit SHA (used with a single --repo, defaults to HEAD when bare)",
    },
  },
  run: async ({ args, ws, output }) => {
    const prd = await runEffect(DomainPrds.getPrd(args.prdId));
    if (!prd) return output.error("not_found", `PRD not found: ${args.prdId}`);

    const repos = await runEffect(DomainRepos.resolveProjectRepos(prd.projectId, ws.path));
    const isMono = repos.length === 1 && repos[0]!.implicit;

    const parsed = parseMergeRequests(args.repo, args.sha);
    if (!parsed.ok) return output.error("validation_error", parsed.message);

    const knownList = repos.map((r) => r.name).join(", ");
    const resolved: Array<{
      repo: { id: string | null; name: string; path: string };
      sha: string;
      capturedFrom: "cwd" | "explicit";
    }> = [];

    for (const req of parsed.requests) {
      if (req.fromCwd) {
        if (isMono) {
          const implicit = repos[0]!;
          const head = await runEffect(captureSha(implicit.path));
          if (!head) {
            return output.error(
              "git_failed",
              `Cannot resolve HEAD in '${implicit.path}'. Is it a git repo?`,
            );
          }
          resolved.push({
            repo: { id: implicit.id, name: implicit.name, path: implicit.path },
            sha: head,
            capturedFrom: "cwd",
          });
        } else {
          const gitRoot = await runEffect(resolveGitRoot(process.cwd()));
          const match = gitRoot
            ? repos.find((r) => path.resolve(r.path) === path.resolve(gitRoot))
            : undefined;
          if (!match) {
            return output.error(
              "repo_not_registered",
              `The current directory is not a registered repo of this multi-repo project. ` +
                `Known repos: ${knownList || "(none)"}. ` +
                `Register it with \`depot project repo add\` (or the project settings page), ` +
                `or pass an explicit --repo <name> --sha <sha>.`,
            );
          }
          const head = await runEffect(captureSha(match.path));
          if (!head) {
            return output.error("git_failed", `Cannot resolve HEAD in '${match.path}'.`);
          }
          resolved.push({
            repo: { id: match.id, name: match.name, path: match.path },
            sha: head,
            capturedFrom: "cwd",
          });
        }
        continue;
      }

      const match = repos.find((r) => r.name === req.repoName);
      if (!match) {
        return output.error(
          "repo_not_registered",
          `Repo '${req.repoName}' is not registered for this project. ` +
            `Known repos: ${knownList || "(none)"}. ` +
            `Register it with \`depot project repo add\` (or the project settings page).`,
        );
      }
      resolved.push({
        repo: { id: match.id, name: match.name, path: match.path },
        sha: req.sha!,
        capturedFrom: "explicit",
      });
    }

    const anchored: Array<{ repoName: string; sha: string }> = [];
    for (const r of resolved) {
      const result = await runEffect(
        DomainPrds.captureMerge({
          prdRevisionId: args.prdId,
          repo: r.repo,
          sha: r.sha,
          capturedFrom: r.capturedFrom,
        }).pipe(
          Effect.match({
            onSuccess: (item) => ({ kind: "ok" as const, item }),
            onFailure: (err) => ({ kind: "err" as const, err }),
          }),
        ),
      );
      if (result.kind === "err") {
        const e = result.err;
        if (e._tag === "ShaNotFoundError") {
          return output.error("sha_not_found", e.message);
        }
        if (e._tag === "PrdNotFoundError") {
          return output.error("not_found", `PRD not found: ${args.prdId}`);
        }
        throw e;
      }
      anchored.push({ repoName: result.item.repoName, sha: result.item.mergeSha });
    }

    if (output.isJson()) {
      output.success({ items: anchored });
    } else {
      for (const a of anchored) {
        output.print(`Captured merge SHA ${a.sha} for repo '${a.repoName}' on PRD ${args.prdId}`);
      }
    }
  },
});

const mergesCommand = command({
  meta: { name: "merges", description: "List the merge anchors of a PRD" },
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
    const merges = await runEffect(DomainPrds.listMerges(args.prdId));
    if (output.isJson()) {
      output.success({ items: merges });
      return;
    }
    if (merges.length === 0) {
      output.print(
        `No merge anchors for PRD ${args.prdId}. Run \`depot prd capture-merge ${args.prdId}\` after a squash merge.`,
      );
      return;
    }
    for (const m of merges) {
      output.print(`${m.repoName}  ${m.mergeSha}  ${formatDate(m.mergedAt)}`);
    }
  },
});

const phaseCommitMessageCommand = command({
  meta: {
    name: "phase-commit-message",
    description: "Persist the suggested commit message for a phase",
  },
  args: {
    prdId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "PRD revision ID",
    },
    phase: {
      schema: Schema.Int.pipe(Schema.positive()),
      coerce: "integer",
      required: true,
      description: "Phase number",
    },
    message: { schema: Schema.String.pipe(Schema.minLength(1)), required: true },
  },
  run: async ({ args, output }) => {
    const snap = await runEffect(
      DomainPrds.upsertPhaseSnapshot(args.prdId, args.phase, {
        suggestedCommitMessage: args.message,
      }),
    );
    if (output.isJson()) output.success({ item: snap });
    else
      output.print(
        `Saved suggested commit message for PRD ${args.prdId} phase ${args.phase} (${snap.id}).`,
      );
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

const buildCheckCommand = (
  scope: "pre-review" | "pre-ship",
  description: string,
  eventType: "pre_review_check" | "pre_ship_check",
) =>
  command({
    meta: { name: `${scope}-check`, description },
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
        DomainDirectives.runScopeBlocking(prd.projectId, scope, { wsPath: ws.path }),
      );
      await runEffect(
        logActivity({
          projectId: prd.projectId,
          workspaceId: prd.workspaceId ?? undefined,
          prdRevisionId: prd.id,
          eventType,
          payload: {
            prdRevisionId: prd.id,
            ok: result.ok,
            failingDirectiveId: result.failingDirectiveId,
          },
        }),
      );
      if (output.isJson()) {
        output.success(result);
      } else {
        output.print(`Running ${result.results.length} ${scope} directive(s) for PRD ${prd.id}:`);
        for (const r of result.results) {
          const icon = r.ok ? "✓" : "✗";
          output.print(`  ${icon} ${r.title} [repo: ${r.repoTarget}] — ${r.durationMs}ms`);
          if (r.noOp) {
            output.print(`    (no modified repo detected — skipped)`);
          }
          if (r.repoResults.length > 1) {
            for (const rr of r.repoResults) {
              const ricon = rr.ok ? "✓" : "✗";
              output.print(`    ${ricon} ${rr.repoName}`);
              if (!rr.ok && rr.stderr) {
                for (const line of rr.stderr.split("\n").slice(0, 8)) {
                  output.print(`      | ${line}`);
                }
              }
            }
          } else if (!r.ok && r.stderr) {
            for (const line of r.stderr.split("\n").slice(0, 10)) {
              output.print(`    | ${line}`);
            }
          }
        }
        if (!result.ok) output.print("Stopped at first blocking failure.");
      }
      if (!result.ok) process.exitCode = 1;
    },
  });

const preReviewCheckCommand = buildCheckCommand(
  "pre-review",
  "Run blocking pre-review directives for a PRD",
  "pre_review_check",
);
const preShipCheckCommand = buildCheckCommand(
  "pre-ship",
  "Run blocking pre-ship directives for a PRD",
  "pre_ship_check",
);

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
    "commit-message": commitMessageCommand,
    "phase-brief": phaseBriefCommand,
    "phase-commit-message": phaseCommitMessageCommand,
    "capture-merge": captureMergeCommand,
    merges: mergesCommand,
    "pre-review-check": preReviewCheckCommand,
    "pre-ship-check": preShipCheckCommand,
    story: storyCommand,
    "out-of-scope": outOfScopeCommand,
  },
});
