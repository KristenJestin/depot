import { defineValidatedCommand } from "#/cli/command";
import { getDb } from "#/cli/runtime";
import { outputSuccess, outputError, isJsonMode } from "#/cli/output";
import {
  listWorkspaces,
  getWorkspace,
  getProject,
  updateWorkspaceLabel,
  removeWorkspace,
} from "#/lib/workflow";
import { log } from "#/lib/logger";
import * as z from "zod";

const listCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "list", description: "List all workspaces" },
  run: async () => {
    const db = await getDb();
    const wsList = await listWorkspaces(db);
    if (isJsonMode()) {
      outputSuccess({ items: wsList });
      return;
    }
    if (wsList.length === 0) {
      console.log("No workspaces found. Run `depot init` to create one.");
      return;
    }
    for (const ws of wsList) {
      const label = ws.label ? `  [${ws.label}]` : "";
      console.log(`${ws.id}  ${ws.path}${label}  project:${ws.projectId}`);
    }
  },
});

const showCommand = defineValidatedCommand({
  schema: z.object({ workspaceId: z.string().min(1) }),
  meta: { name: "show", description: "Show workspace details" },
  args: {
    workspaceId: {
      type: "positional",
      description: "Workspace ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const ws = await getWorkspace(db, args.workspaceId);
    if (!ws) {
      outputError("not_found", `Workspace not found: ${args.workspaceId}`);
    }
    const project = await getProject(db, ws.projectId);
    if (isJsonMode()) {
      outputSuccess({ item: ws, project });
    } else {
      log.fields([
        ["ID", ws.id],
        ["Path", ws.path],
        ["Label", ws.label],
        ["Project", project ? `${project.name} (${project.id})` : ws.projectId],
        ["Created", ws.createdAt],
        ["Updated", ws.updatedAt],
      ]);
    }
  },
});

const renameCommand = defineValidatedCommand({
  schema: z.object({
    workspaceId: z.string().min(1),
    label: z.string().min(1),
  }),
  meta: { name: "rename", description: "Set or update the workspace label" },
  args: {
    workspaceId: {
      type: "positional",
      description: "Workspace ID",
      required: true,
    },
    label: {
      type: "string",
      alias: "l",
      description: "New workspace label",
      required: true,
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const ws = await getWorkspace(db, args.workspaceId);
    if (!ws) {
      outputError("not_found", `Workspace not found: ${args.workspaceId}`);
    }
    const updated = await updateWorkspaceLabel(db, ws.id, args.label);
    if (isJsonMode()) {
      outputSuccess({ item: updated });
    } else {
      console.log(`Renamed workspace ${updated.id} -> label '${updated.label}'`);
    }
  },
});

const removeCommand = defineValidatedCommand({
  schema: z.object({
    workspaceId: z.string().min(1),
    force: z.boolean().default(false),
  }),
  meta: {
    name: "remove",
    description: "Remove a workspace (blocked if PRDs exist unless --force)",
  },
  args: {
    workspaceId: {
      type: "positional",
      description: "Workspace ID",
      required: true,
    },
    force: {
      type: "boolean",
      description: "Remove workspace and all linked data (PRDs, tasks, reviews)",
      default: false,
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const ws = await getWorkspace(db, args.workspaceId);
    if (!ws) {
      outputError("not_found", `Workspace not found: ${args.workspaceId}`);
    }
    try {
      await removeWorkspace(db, ws.id, args.force);
    } catch (err) {
      outputError("linked_data", err instanceof Error ? err.message : String(err));
    }
    if (isJsonMode()) {
      outputSuccess({ removed: ws.id });
    } else {
      console.log(`Removed workspace ${ws.id} (${ws.path})`);
    }
  },
});

export const workspaceCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "workspace", description: "Workspace management" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    rename: renameCommand,
    remove: removeCommand,
  },
});
