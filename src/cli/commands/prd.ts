import { defineValidatedCommand } from "#/cli/command";
import { resolveCurrentWorkspace } from "#/cli/runtime";
import {
  createPrd,
  listPrds,
  commitPrd,
  activatePrd,
  amendPrd,
  getPrd,
} from "#/lib/workflow";
import { log } from "#/lib/logger";
import * as z from "zod";

const createPrdSchema = z.object({
  title: z.string().min(1),
  context: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
});

const prdIdSchema = z.object({
  prdId: z.string().min(1),
});

const amendPrdSchema = z.object({
  prdId: z.string().min(1),
  title: z.string().min(1).optional(),
  context: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
});

const createCommand = defineValidatedCommand({
  schema: createPrdSchema,
  meta: { name: "create", description: "Create a new PRD in draft status" },
  args: {
    title: {
      type: "string",
      alias: "t",
      description: "PRD title",
      required: true,
    },
    context: {
      type: "string",
      alias: "c",
      description: "Why this PRD exists",
    },
    scope: {
      type: "string",
      alias: "s",
      description: "What is included and excluded",
    },
  },
  run: async ({ args }) => {
    const { db, ws } = await resolveCurrentWorkspace();
    const prd = await createPrd(db, {
      projectId: ws.projectId,
      workspaceId: ws.id,
      title: args.title,
      context: args.context,
      scope: args.scope,
    });
    console.log(`Created PRD '${prd.title}' (${prd.id}) [draft]`);
  },
});

const showCommand = defineValidatedCommand({
  schema: prdIdSchema,
  meta: { name: "show", description: "Show PRD details" },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const prd = await getPrd(db, args.prdId);
    if (!prd) {
      console.error(`PRD not found: ${args.prdId}`);
      process.exit(1);
    }
    log.fields([
      ["ID", prd.id],
      ["Title", prd.title],
      ["Status", prd.status],
      ["Revision", prd.revision],
      ["Context", prd.context],
      ["Scope", prd.scope],
      ["Parent", prd.parentId],
      ["Created", prd.createdAt],
      ["Committed", prd.committedAt],
      ["Activated", prd.activatedAt],
    ]);
  },
});

const listCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "list", description: "List PRDs for the current project" },
  run: async () => {
    const { db, ws } = await resolveCurrentWorkspace();
    const prdList = await listPrds(db, { projectId: ws.projectId });
    if (prdList.length === 0) {
      console.log("No PRDs found. Run `depot prd create` to create one.");
      return;
    }
    for (const p of prdList) {
      console.log(`${p.id}  ${p.title}  [${p.status}]  rev ${p.revision}`);
    }
  },
});

const commitCommand = defineValidatedCommand({
  schema: prdIdSchema,
  meta: {
    name: "commit",
    description: "Commit a draft PRD (freeze for execution)",
  },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const prd = await getPrd(db, args.prdId);
    if (!prd) {
      console.error(`PRD not found: ${args.prdId}`);
      process.exit(1);
    }
    const committed = await commitPrd(db, prd.id);
    console.log(`Committed PRD '${committed.title}' (${committed.id})`);
  },
});

const activateCommand = defineValidatedCommand({
  schema: prdIdSchema,
  meta: {
    name: "activate",
    description: "Activate a committed PRD (move to in_progress)",
  },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const prd = await getPrd(db, args.prdId);
    if (!prd) {
      console.error(`PRD not found: ${args.prdId}`);
      process.exit(1);
    }
    const activated = await activatePrd(db, prd.id);
    console.log(`Activated PRD '${activated.title}' (${activated.id})`);
  },
});

const amendCommand = defineValidatedCommand({
  schema: amendPrdSchema,
  meta: {
    name: "amend",
    description: "Amend a committed/active PRD (creates new revision, archives original)",
  },
  args: {
    prdId: {
      type: "positional",
      description: "PRD ID",
      required: true,
    },
    title: {
      type: "string",
      alias: "t",
      description: "New title",
    },
    context: {
      type: "string",
      alias: "c",
      description: "New context",
    },
    scope: {
      type: "string",
      alias: "s",
      description: "New scope",
    },
  },
  run: async ({ args }) => {
    const { db } = await resolveCurrentWorkspace();
    const prd = await getPrd(db, args.prdId);
    if (!prd) {
      console.error(`PRD not found: ${args.prdId}`);
      process.exit(1);
    }
    const amended = await amendPrd(db, prd.id, {
      title: args.title,
      context: args.context,
      scope: args.scope,
    });
    console.log(`Amended PRD -> '${amended.title}' (${amended.id}) rev ${amended.revision}`);
  },
});

export const prdCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "prd", description: "PRD management" },
  subCommands: {
    create: createCommand,
    show: showCommand,
    list: listCommand,
    commit: commitCommand,
    activate: activateCommand,
    amend: amendCommand,
  },
});
