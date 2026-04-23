import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { createProject, addWorkspace, listProjects } from "#/lib/workflow";
import { resolveOrCreateWorkspaceForPath } from "#/modules/workspaces/bootstrap";

let db: Database;

beforeEach(() => {
  ({ db } = createTestDb());
});

describe("workspace bootstrap", () => {
  it("resolves an existing workspace without creating a new project", async () => {
    const project = await createProject(db, { name: "existing-project" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/existing-project",
    });

    const resolved = await resolveOrCreateWorkspaceForPath(db, "/workspace/existing-project/src");

    expect(resolved.created).toBe(false);
    expect(resolved.project.id).toBe(project.id);
    expect(resolved.workspace.id).toBe(workspace.id);
  });

  it("creates a project and workspace when none exist for the path", async () => {
    const resolved = await resolveOrCreateWorkspaceForPath(db, "/workspace/new-project");

    expect(resolved.created).toBe(true);
    expect(resolved.project.name).toBe("new-project");
    expect(resolved.workspace.projectId).toBe(resolved.project.id);
    expect(resolved.workspace.path).toBe("/workspace/new-project");
  });

  it("creates a fresh project instead of reusing one with the same name", async () => {
    const existingProject = await createProject(db, { name: "shared-name" });
    await addWorkspace(db, {
      projectId: existingProject.id,
      path: "/other/shared-name",
    });

    const resolved = await resolveOrCreateWorkspaceForPath(db, "/workspace/shared-name");
    const projects = await listProjects(db);

    expect(resolved.created).toBe(true);
    expect(resolved.project.name).toBe("shared-name");
    expect(resolved.project.id).not.toBe(existingProject.id);
    expect(resolved.workspace.projectId).toBe(resolved.project.id);
    expect(projects.filter((project) => project.name === "shared-name")).toHaveLength(2);
  });
});
