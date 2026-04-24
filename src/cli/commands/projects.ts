import { Schema } from "effect";
import { command } from "#/cli/command";
import { runEffect } from "#/cli/runtime";
import * as DomainProjects from "#/modules/projects/domain";
import * as DomainWorkspaces from "#/modules/workspaces/domain";
import { normalizeWorkspacePath, formatDate } from "#/shared/utils";
import { VALID_PROJECT_STATUSES } from "#/shared/validator";
import * as path from "node:path";

export const initCommand = command({
  meta: {
    name: "init",
    description: "Initialize a project and link the current directory as a workspace",
  },
  args: {
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      positional: true,
      description: "Project name (defaults to current folder name)",
    },
    path: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "p",
      description: "Workspace path (defaults to cwd)",
    },
    description: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "d",
      description: "Project description",
    },
    label: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "l",
      description: "Workspace label",
    },
  },
  run: async ({ args, output }) => {
    const rawWsPath = path.resolve(args.path ?? process.cwd());
    const wsPath = normalizeWorkspacePath(rawWsPath);
    const projectName = args.name ?? path.basename(rawWsPath);

    // Check if workspace already exists at this exact path
    const existing = await runEffect(DomainWorkspaces.resolveWorkspace(wsPath));
    if (existing && existing.path === wsPath) {
      const project = await runEffect(DomainProjects.getProject(existing.projectId));
      if (!project) {
        return output.error("not_found", `Project not found for workspace: ${existing.projectId}`);
      }
      if (output.isJson()) {
        output.success({ project, workspace: existing });
      } else {
        output.print(
          `Workspace already registered for project '${project?.name}' (${existing.projectId})`,
        );
        output.print(`Path: ${existing.path}`);
      }
      return;
    }

    // Reuse an existing project with the same name, or create a new one
    const projects = await runEffect(DomainProjects.listProjects());
    let project = projects.find((p) => p.name === projectName);

    if (!project) {
      project = await runEffect(
        DomainProjects.createProject({
          name: projectName,
          description: args.description,
        }),
      );
      if (!output.isJson()) {
        output.print(`Created project '${project.name}' (${project.id})`);
      }
    } else {
      if (!output.isJson()) {
        output.print(`Using existing project '${project.name}' (${project.id})`);
      }
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
      output.print(`Linked workspace ${ws.id} -> ${ws.path}`);
    }
  },
});

const listCommand = command({
  meta: { name: "list", description: "List all projects" },
  run: async ({ output }) => {
    const projects = await runEffect(DomainProjects.listProjects());
    if (output.isJson()) {
      output.success({ items: projects });
      return;
    }
    if (projects.length === 0) {
      output.print("No projects found. Run `depot init` to create one.");
      return;
    }
    for (const p of projects) {
      output.print(`${p.id}  ${p.name}  [${p.status}]`);
    }
  },
});

const showCommand = command({
  meta: { name: "show", description: "Show project details" },
  args: {
    projectId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Project ID",
    },
  },
  run: async ({ args, output }) => {
    const project = await runEffect(DomainProjects.getProject(args.projectId));
    if (!project) return output.error("not_found", `Project not found: ${args.projectId}`);
    if (output.isJson()) {
      output.success({ item: project });
    } else {
      output.fields([
        ["ID", project.id],
        ["Name", project.name],
        ["Status", project.status],
        ["Description", project.description],
        ["Created", formatDate(project.createdAt)],
        ["Updated", formatDate(project.updatedAt)],
      ]);
    }
  },
});

const updateCommand = command({
  meta: { name: "update", description: "Update project name, description, or status" },
  args: {
    projectId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Project ID",
    },
    name: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "n",
      description: "New project name",
    },
    description: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      alias: "d",
      description: "New project description",
    },
    status: {
      schema: Schema.Literal(...VALID_PROJECT_STATUSES),
      alias: "s",
      description: `New project status (${VALID_PROJECT_STATUSES.join(", ")})`,
    },
  },
  run: async ({ args, output }) => {
    const project = await runEffect(DomainProjects.getProject(args.projectId));
    if (!project) return output.error("not_found", `Project not found: ${args.projectId}`);
    if (!args.name && !args.description && !args.status) {
      return output.error(
        "no_changes",
        "No changes provided. Use --name, --description, or --status.",
      );
    }
    const updated = await runEffect(
      DomainProjects.updateProject(project.id, {
        name: args.name,
        description: args.description,
        status: args.status,
      }),
    );
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Updated project '${updated.name}' (${updated.id}) [${updated.status}]`);
    }
  },
});

const archiveCommand = command({
  meta: { name: "archive", description: "Archive a project (set status to done)" },
  args: {
    projectId: {
      schema: Schema.String.pipe(Schema.minLength(1)),
      required: true,
      positional: true,
      description: "Project ID",
    },
  },
  run: async ({ args, output }) => {
    const project = await runEffect(DomainProjects.getProject(args.projectId));
    if (!project) return output.error("not_found", `Project not found: ${args.projectId}`);
    if (project.status === "done") {
      return output.error("already_done", `Project '${project.name}' is already archived (done).`);
    }
    const updated = await runEffect(DomainProjects.updateProject(project.id, { status: "done" }));
    if (output.isJson()) {
      output.success({ item: updated });
    } else {
      output.print(`Archived project '${updated.name}' (${updated.id}) [done]`);
    }
  },
});

export const projectCommand = command({
  meta: { name: "project", description: "Project management" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    update: updateCommand,
    archive: archiveCommand,
  },
});
