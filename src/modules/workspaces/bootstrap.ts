import path from "node:path";
import type { Database } from "#/db/client";
import { addWorkspace, createProject, getProject, resolveWorkspace } from "#/lib/workflow";
import { normalizeWorkspacePath } from "#/shared/utils";

export async function resolveOrCreateWorkspaceForPath(db: Database, currentPath: string) {
  const normalizedPath = normalizeWorkspacePath(currentPath);
  const existingWorkspace = await resolveWorkspace(db, normalizedPath);
  if (existingWorkspace) {
    const existingProject = await getProject(db, existingWorkspace.projectId);
    if (!existingProject) {
      throw new Error(`Project not found: ${existingWorkspace.projectId}`);
    }

    return {
      workspace: existingWorkspace,
      project: existingProject,
      created: false,
    };
  }

  const projectName = path.basename(path.resolve(currentPath)) || "project";
  const project = await createProject(db, { name: projectName });

  const workspace = await addWorkspace(db, {
    projectId: project.id,
    path: normalizedPath,
  });

  return {
    workspace,
    project,
    created: true,
  };
}
