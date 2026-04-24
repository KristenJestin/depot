import { Schema, Effect } from "effect";
import { readFile } from "node:fs/promises";
import { command } from "#/cli/command";
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
    scope: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "s",
      description: "What is included and excluded",
    },
  },
  run: async ({ args, ws, output }) => {
    const prd = await runEffect(
      DomainPrds.createPrd({
        projectId: ws.projectId,
        title: args.title,
        context: args.context,
        scope: args.scope,
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
        ["Root", prd.rootId],
        ["Context", prd.context],
        ["Scope", prd.scope],
        ["Parent", prd.parentId],
        ["Created", formatDate(prd.createdAt)],
        ["Ready", formatDate(prd.readyAt)],
        ["Activated", formatDate(prd.activatedAt)],
      ]);
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
        Effect.catchTag("PrdNotFoundError", () => Effect.succeed(null)),
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

export const prdCommand = command({
  meta: { name: "prd", description: "PRD management" },
  subCommands: {
    create: createCommand,
    show: showCommand,
    list: listCommand,
    activate: activateCommand,
    ready: readyCommand,
    done: doneCommand,
    cancel: cancelCommand,
    fork: forkCommand,
    load: loadCommand,
  },
});
