import { Effect, Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainWorkspaces from "#/modules/workspaces/domain";
import * as DomainProjects from "#/modules/projects/domain";
import { formatDate } from "#/shared/utils";

const listCommand = command({
  meta: { name: "list", description: "List all workspaces" },
  run: async ({ output }) => {
    const wsList = await runEffect(DomainWorkspaces.listWorkspaces());
    if (output.isJson()) {
      output.success({ items: wsList });
      return;
    }
    if (wsList.length === 0) {
      output.print("No workspaces found. Run `depot init` to create one.");
      return;
    }
    for (const ws of wsList) {
      const label = ws.label ? `  [${ws.label}]` : "";
      output.print(`${ws.id}  ${ws.path}${label}  project:${ws.projectId}`);
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show workspace details" },
  args: {
    workspaceId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Workspace ID",
    },
  },
  run: async ({ args, output }) => {
    const ws = await runEffect(DomainWorkspaces.getWorkspace(args.workspaceId));
    if (!ws) return output.error("not_found", `Workspace not found: ${args.workspaceId}`);
    const project = await runEffect(DomainProjects.getProject(ws.projectId));
    if (output.isJson()) {
      output.success({ item: ws, project });
    } else {
      output.fields([
        ["ID", ws.id],
        ["Path", ws.path],
        ["Label", ws.label],
        ["Project", project ? `${project.name} (${project.id})` : ws.projectId],
        ["Created", formatDate(ws.createdAt)],
        ["Updated", formatDate(ws.updatedAt)],
      ]);
    }
  },
});

const renameCommand = command({
  meta: { name: "rename", description: "Set or update the workspace label" },
  args: {
    workspaceId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Workspace ID",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      alias: "l",
      description: "New workspace label",
    },
  },
  run: async ({ args, output }) => {
    const ws = await runEffect(DomainWorkspaces.getWorkspace(args.workspaceId));
    if (!ws) return output.error("not_found", `Workspace not found: ${args.workspaceId}`);
    const updated = await runEffect(DomainWorkspaces.updateWorkspaceLabel(ws.id, args.label));
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Renamed workspace ${updated.id} -> label '${updated.label}'`);
    }
  },
});

const removeCommand = command({
  meta: {
    name: "remove",
    description: "Remove a workspace (blocked if PRDs exist unless --force)",
  },
  args: {
    workspaceId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Workspace ID",
    },
    force: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Remove workspace and all linked data (PRDs, tasks, reviews)",
    },
  },
  run: async ({ args, output }) => {
    const ws = await runEffect(DomainWorkspaces.getWorkspace(args.workspaceId));
    if (!ws) return output.error("not_found", `Workspace not found: ${args.workspaceId}`);

    const result = await runEffect(
      DomainWorkspaces.removeWorkspace(ws.id, args.force).pipe(
        Effect.match({
          onFailure: (e) => ({ ok: false as const, error: e }),
          onSuccess: () => ({ ok: true as const }),
        }),
      ),
    );

    if (!result.ok) {
      return output.error("linked_data", result.error.message);
    }

    if (output.isJson()) {
      output.success({ removed: ws.id });
    } else {
      output.print(`Removed workspace ${ws.id} (${ws.path})`);
    }
  },
});

export const workspaceCommand = command({
  meta: { name: "workspace", description: "Workspace management" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    rename: renameCommand,
    remove: removeCommand,
  },
});
