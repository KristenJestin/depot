import { Schema, Effect } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
import { resolveTextInput } from "#/cli/file-input";
import { runEffect } from "#/cli/runtime";
import * as DomainPrds from "#/modules/prds/domain";
import * as DomainTasks from "#/modules/tasks/domain";
import * as DomainReviews from "#/modules/reviews/domain";
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
    if (output.isJson()) {
      output.success({ item: prd });
    } else {
      output.fields([
        ["ID", prd.id],
        ["Title", prd.title],
        ["Status", prd.status],
        ["Revision", prd.revision],
        ["PRD", prd.prdId],
        ["Context", prd.context],
        ["Scope", prd.scope],
        ["Created", formatDate(prd.createdAt)],
        ["Ready", formatDate(prd.readyAt)],
        ["Activated", prd.activatedAt ? formatDateWithRelative(prd.activatedAt) : "—"],
      ]);
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
    const activated = await runEffect(
      DomainPrds.activatePrd(args.prdId, ws.id).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!activated) return output.error("not_found", `PRD not found: ${args.prdId}`);
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
    const checks: Array<{ level: "ok" | "warn" | "error"; message: string }> = [];

    checks.push({ level: prd.title.trim().length > 0 ? "ok" : "error", message: `title set` });
    checks.push({
      level: prd.context && prd.context.trim().length > 0 ? "ok" : "warn",
      message: `context set${prd.context ? ` (${prd.context.length} chars)` : ""}`,
    });
    checks.push({
      level: prd.scope && prd.scope.trim().length > 0 ? "ok" : "warn",
      message: `scope set${prd.scope ? ` (${prd.scope.length} chars)` : ""}`,
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

export const prdCommand = command({
  meta: { name: "prd", description: "PRD management" },
  subCommands: {
    create: createCommand,
    show: showCommand,
    update: updateCommand,
    list: listCommand,
    activate: activateCommand,
    ready: readyCommand,
    done: doneCommand,
    close: closeCommand,
    cancel: cancelCommand,
    discard: discardCommand,
    fork: forkCommand,
    load: loadCommand,
    reload: reloadCommand,
    validate: validateCommand,
    status: statusCommand,
    findings: findingsCommand,
    "phase-advance": phaseAdvanceCommand,
  },
});
