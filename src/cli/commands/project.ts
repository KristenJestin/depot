import { defineValidatedCommand } from "#/cli/command";
import { getDb } from "#/cli/runtime";
import { outputSuccess, isJsonMode } from "#/cli/output";
import {
  createProject,
  addWorkspace,
  resolveWorkspace,
  listProjects,
  getProject,
} from "#/lib/workflow";
import { normalizeWorkspacePath } from "#/lib/paths";
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

export const projectCommand = defineValidatedCommand({
  schema: z.object({}),
  meta: { name: "project", description: "Project management" },
  subCommands: {
    list: listCommand,
  },
});
