import { defineCommand } from "citty";
import { getDb } from "#/cli/context";
import {
  createProject,
  addWorkspace,
  resolveWorkspace,
  listProjects,
  getProject,
} from "#/lib/workflow";
import { shortId } from "#/lib/ids";
import { normalizeWorkspacePath } from "#/lib/paths";
import * as path from "path";

export const initCommand = defineCommand({
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
      console.log(
        `Workspace already registered for project '${project?.name}' (${shortId(existing.projectId)})`,
      );
      console.log(`Path: ${existing.path}`);
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
      console.log(`Created project '${project.name}' (${shortId(project.id)})`);
    } else {
      console.log(`Using existing project '${project.name}' (${shortId(project.id)})`);
    }

    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: wsPath,
      label: args.label,
    });
    console.log(`Linked workspace ${shortId(ws.id)} -> ${ws.path}`);
  },
});

const listCommand = defineCommand({
  meta: { name: "list", description: "List all projects" },
  run: async () => {
    const db = await getDb();
    const projects = await listProjects(db);
    if (projects.length === 0) {
      console.log("No projects found. Run `depot init` to create one.");
      return;
    }
    for (const p of projects) {
      console.log(`${shortId(p.id)}  ${p.name}  [${p.status}]`);
    }
  },
});

export const projectCommand = defineCommand({
  meta: { name: "project", description: "Project management" },
  subCommands: {
    list: listCommand,
  },
});
