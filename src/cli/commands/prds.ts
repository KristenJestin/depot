import { Schema, Effect } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
import { resolveTextInput } from "#/cli/file-input";
import { runEffect } from "#/cli/runtime";
import * as DomainPrds from "#/modules/prds/domain";
import { effortSchema } from "#/shared/schemas";
import { formatDate } from "#/shared/utils";
import { parseJsonSchema } from "#/lib/json";

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
        ["Activated", formatDate(prd.activatedAt)],
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
  meta: { name: "list", description: "List PRDs for the current project" },
  workspace: true,
  run: async ({ ws, output }) => {
    const prdList = await runEffect(
      DomainPrds.listPrds({ projectId: ws.projectId, latestOnly: true }),
    );
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
  },
  run: async ({ args, output }) => {
    const updated = await runEffect(
      DomainPrds.donePrd(args.prdId).pipe(
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
      ),
    );
    if (!updated) return output.error("not_found", `PRD not found: ${args.prdId}`);
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Marked PRD '${updated.title}' (${updated.id}) as done`);
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
    cancel: cancelCommand,
    fork: forkCommand,
    load: loadCommand,
    reload: reloadCommand,
    "phase-advance": phaseAdvanceCommand,
  },
});
