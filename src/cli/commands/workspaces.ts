import { Effect, Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainWorkspaces from "#/modules/workspaces/domain";
import * as DomainProjects from "#/modules/projects/domain";
import { formatDate, normalizeWorkspacePath } from "#/shared/utils";
import * as path from "node:path";

const listCommand = command({
  meta: { name: "list", description: "List all workspaces" },
  args: {
    includeOrphans: {
      schema: Schema.Boolean,
      type: "boolean",
      default: false,
      description: "Include workspaces whose folder no longer exists on disk",
    },
  },
  run: async ({ args, output }) => {
    const wsList = await runEffect(DomainWorkspaces.listWorkspaces());
    // Orphan masking: hide workspaces whose folder was deleted on disk
    // unless the user explicitly opts in via --include-orphans.
    const annotated = wsList.map((ws) => ({
      ws,
      isOrphan: !DomainWorkspaces.workspaceExistsOnDisk(ws),
    }));
    const visible = args.includeOrphans ? annotated : annotated.filter((row) => !row.isOrphan);

    if (output.isJson()) {
      output.success({
        items: visible.map((row) => ({ ...row.ws, isOrphan: row.isOrphan })),
      });
      return;
    }
    if (visible.length === 0) {
      output.print("No workspaces found. Run `depot init` to create one.");
      return;
    }
    for (const { ws, isOrphan } of visible) {
      const label = ws.label ? `  [${ws.label}]` : "";
      const orphan = isOrphan ? "  (orphan)" : "";
      output.print(`${ws.id}  ${ws.path}${label}  project:${ws.projectId}${orphan}`);
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

const addCommand = command({
  meta: {
    name: "add",
    alias: ["link"],
    description: "Attach a folder as a workspace of an existing project",
  },
  args: {
    project: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      description: "Project id or name",
    },
    path: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "p",
      description: "Workspace path (defaults to cwd)",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "l",
      description: "Workspace label",
    },
  },
  run: async ({ args, output }) => {
    const inputPath = args.path ?? process.cwd();
    const rawPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath);
    const wsPath = normalizeWorkspacePath(rawPath);

    const projects = await runEffect(DomainProjects.listProjects());
    const byId = projects.find((p) => p.id === args.project);
    let project = byId;
    if (!project) {
      const byName = projects.filter((p) => p.name === args.project);
      if (byName.length > 1) {
        return output.error(
          "ambiguous_project",
          `Project name '${args.project}' is ambiguous (matches ${byName.length} projects: ${byName
            .map((p) => p.id)
            .join(", ")}). Pass a project id instead.`,
        );
      }
      project = byName[0];
    }
    if (!project) {
      return output.error(
        "project_not_found",
        `Project not found: '${args.project}'. Use \`depot project list\` to find the project id or name.`,
      );
    }

    const existing = (await runEffect(DomainWorkspaces.listWorkspaces())).find(
      (w) => normalizeWorkspacePath(w.path) === wsPath,
    );
    if (existing) {
      const existingProject = await runEffect(DomainProjects.getProject(existing.projectId));
      if (output.isJson()) {
        output.success({ project: existingProject, workspace: existing, alreadyLinked: true });
      } else {
        output.print(
          `Workspace already registered for project '${existingProject?.name ?? existing.projectId}' (${existing.projectId})`,
        );
        output.print(`Path: ${existing.path}`);
      }
      return;
    }

    const ws = await runEffect(
      DomainWorkspaces.addWorkspace({
        projectId: project.id,
        path: wsPath,
        label: args.label,
      }),
    );

    if (output.isJson()) {
      output.success({ project, workspace: ws });
    } else {
      output.print(`Linked workspace ${ws.id} -> ${ws.path} (project '${project.name}')`);
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
    add: addCommand,
  },
});
