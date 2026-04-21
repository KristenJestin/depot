import { defineValidatedCommand } from "#/cli/command";
import { getDb } from "#/cli/runtime";
import { outputSuccess, outputError, isJsonMode } from "#/cli/output";
import {
  createProject,
  addWorkspace,
  resolveWorkspace,
  listProjects,
  getProject,
  updateProject,
} from "#/lib/workflow";
import { log } from "#/lib/logger";
import { normalizeWorkspacePath } from "#/lib/paths";
import { VALID_PROJECT_STATUSES } from "#/lib/validator";
import * as path from "path";
import * as z from "zod";

const initArgsSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
});

export const initCommand = defineValidatedCommand({
  schema: initArgsSchema,
  meta: {
    name: "init",
    description: "Initialize a project and link the current directory as a workspace",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name (defaults to current folder name)",
      required: false,
    },
    path: {
      type: "string",
      alias: "p",
      description: "Workspace path (defaults to cwd)",
    },
    description: {
      type: "string",
      alias: "d",
      description: "Project description",
    },
    label: {
      type: "string",
      alias: "l",
      description: "Workspace label",
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const rawWsPath = path.resolve(args.path ?? process.cwd());
    const wsPath = normalizeWorkspacePath(rawWsPath);
    const projectName = args.name ?? path.basename(rawWsPath);

    // Check if workspace already exists at this exact path
    const existing = await resolveWorkspace(db, wsPath);
    if (existing && existing.path === wsPath) {
      const project = await getProject(db, existing.projectId);
      if (isJsonMode()) {
        outputSuccess({ project, workspace: existing });
      } else {
        console.log(`Workspace already registered for project '${project?.name}' (${existing.projectId})`);
        console.log(`Path: ${existing.path}`);
      }
      return;
    }

    // Reuse an existing project with the same name, or create a new one
    const projects = await listProjects(db);
    let project = projects.find((p) => p.name === projectName);

    if (!project) {
      project = await createProject(db, {
        name: projectName,
        description: args.description,
      });
      if (!isJsonMode()) {
        console.log(`Created project '${project.name}' (${project.id})`);
      }
    } else {
      if (!isJsonMode()) {
        console.log(`Using existing project '${project.name}' (${project.id})`);
      }
    }

    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: wsPath,
      label: args.label,
    });

    if (isJsonMode()) {
      outputSuccess({ project, workspace: ws });
    } else {
      console.log(`Linked workspace ${ws.id} -> ${ws.path}`);
    }
  },
});

const listCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "list", description: "List all projects" },
  run: async () => {
    const db = await getDb();
    const projects = await listProjects(db);
    if (isJsonMode()) {
      outputSuccess({ items: projects });
      return;
    }
    if (projects.length === 0) {
      console.log("No projects found. Run `depot init` to create one.");
      return;
    }
    for (const p of projects) {
      console.log(`${p.id}  ${p.name}  [${p.status}]`);
    }
  },
});

const showCommand = defineValidatedCommand({
  schema: z.object({ projectId: z.string().min(1) }),
  meta: { name: "show", description: "Show project details" },
  args: {
    projectId: {
      type: "positional",
      description: "Project ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const project = await getProject(db, args.projectId);
    if (!project) {
      outputError("not_found", `Project not found: ${args.projectId}`);
    }
    if (isJsonMode()) {
      outputSuccess({ item: project });
    } else {
      log.fields([
        ["ID", project.id],
        ["Name", project.name],
        ["Status", project.status],
        ["Description", project.description],
        ["Created", project.createdAt],
        ["Updated", project.updatedAt],
      ]);
    }
  },
});

const updateCommand = defineValidatedCommand({
  schema: z.object({
    projectId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    status: z.enum(VALID_PROJECT_STATUSES).optional(),
  }),
  meta: { name: "update", description: "Update project name, description, or status" },
  args: {
    projectId: {
      type: "positional",
      description: "Project ID",
      required: true,
    },
    name: {
      type: "string",
      alias: "n",
      description: "New project name",
    },
    description: {
      type: "string",
      alias: "d",
      description: "New project description",
    },
    status: {
      type: "string",
      alias: "s",
      description: `New project status (${VALID_PROJECT_STATUSES.join(", ")})`,
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const project = await getProject(db, args.projectId);
    if (!project) {
      outputError("not_found", `Project not found: ${args.projectId}`);
    }
    if (!args.name && !args.description && !args.status) {
      outputError("no_changes", "No changes provided. Use --name, --description, or --status.");
    }
    const updated = await updateProject(db, project.id, {
      name: args.name,
      description: args.description,
      status: args.status,
    });
    if (isJsonMode()) {
      outputSuccess({ item: updated });
    } else {
      console.log(`Updated project '${updated.name}' (${updated.id}) [${updated.status}]`);
    }
  },
});

const archiveCommand = defineValidatedCommand({
  schema: z.object({ projectId: z.string().min(1) }),
  meta: { name: "archive", description: "Archive a project (set status to done)" },
  args: {
    projectId: {
      type: "positional",
      description: "Project ID",
      required: true,
    },
  },
  run: async ({ args }) => {
    const db = await getDb();
    const project = await getProject(db, args.projectId);
    if (!project) {
      outputError("not_found", `Project not found: ${args.projectId}`);
    }
    if (project.status === "done") {
      outputError("already_done", `Project '${project.name}' is already archived (done).`);
    }
    const updated = await updateProject(db, project.id, { status: "done" });
    if (isJsonMode()) {
      outputSuccess({ item: updated });
    } else {
      console.log(`Archived project '${updated.name}' (${updated.id}) [done]`);
    }
  },
});

export const projectCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "project", description: "Project management" },
  subCommands: {
    list: listCommand,
    show: showCommand,
    update: updateCommand,
    archive: archiveCommand,
  },
});
