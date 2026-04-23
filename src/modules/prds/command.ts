import { Schema, Effect } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainPrds from "#/modules/prds/domain";
import { formatDate } from "#/shared/utils";

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
  },
});
