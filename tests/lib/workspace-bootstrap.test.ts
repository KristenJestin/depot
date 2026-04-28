import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { createProject, addWorkspace, listProjects } from "#/lib/workflow";
import { detectGitContext, resolveOrCreateWorkspaceForPath } from "#/modules/workspaces/bootstrap";
import type { execFile as ExecFileFn, ChildProcess } from "node:child_process";

vi.mock("node:child_process", () => ({ execFile: vi.fn<typeof ExecFileFn>() }));

import { execFile } from "node:child_process";
const mockExecFile = vi.mocked(execFile);

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;

function mockExec(stdout: string) {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    (cb as unknown as ExecFileCallback)(null, stdout, "");
    return {} as ChildProcess;
  });
}

function mockExecFail() {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
    (cb as unknown as ExecFileCallback)(new Error("git command failed"), "", "");
    return {} as ChildProcess;
  });
}

let db: Database;

beforeEach(() => {
  ({ db } = createTestDb());
  vi.restoreAllMocks();
});

describe("detectGitContext", () => {
  it("returns null when git rev-parse fails (not a git repo)", async () => {
    mockExecFail();

    const result = await detectGitContext("/tmp/not-a-repo");

    expect(result).toBeNull();
  });

  it("returns gitRoot and branch when in a git repo", async () => {
    mockExec("/home/user/myproject\n"); // rev-parse --show-toplevel
    mockExec("feature-branch\n"); // rev-parse --abbrev-ref HEAD
    mockExec("worktree /home/user/myproject\n"); // worktree list

    const result = await detectGitContext("/home/user/myproject");

    expect(result).not.toBeNull();
    expect(result!.gitRoot).toBe("/home/user/myproject");
    expect(result!.branch).toBe("feature-branch");
  });

  it("returns undefined branch when branch detection fails", async () => {
    mockExec("/home/user/myproject\n"); // rev-parse --show-toplevel
    mockExecFail(); // branch detection fails
    mockExec("worktree /home/user/myproject\n"); // worktree list

    const result = await detectGitContext("/home/user/myproject");

    expect(result).not.toBeNull();
    expect(result!.branch).toBeUndefined();
  });

  it("returns undefined mainWorktreePath when cwd is the main worktree", async () => {
    mockExec("/home/user/myproject\n"); // rev-parse --show-toplevel
    mockExec("main\n"); // branch
    mockExec("worktree /home/user/myproject\n"); // worktree list (only main)

    const result = await detectGitContext("/home/user/myproject");

    expect(result!.mainWorktreePath).toBeUndefined();
  });

  it("returns mainWorktreePath when cwd is a linked worktree", async () => {
    mockExec("/home/user/myproject-feat\n"); // rev-parse --show-toplevel
    mockExec("feat\n"); // branch
    mockExec("worktree /home/user/myproject\n\nworktree /home/user/myproject-feat\n"); // worktree list

    const result = await detectGitContext("/home/user/myproject-feat");

    expect(result!.mainWorktreePath).toBe("/home/user/myproject");
  });
});

describe("workspace bootstrap", () => {
  beforeEach(() => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(new Error("not a git repo"), "", "");
      return {} as ChildProcess;
    });
  });

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
