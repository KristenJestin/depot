import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
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
  const tempDirs: string[] = [];

  beforeEach(() => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as unknown as ExecFileCallback)(new Error("not a git repo"), "", "");
      return {} as ChildProcess;
    });
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves an existing workspace without creating a new project", async () => {
    const project = await createProject(db, { name: "existing-project" });
    // Real dir on disk — resolveWorkspace masks orphan workspaces.
    const wsDir = await fs.mkdtemp(path.join(tmpdir(), "depot-bootstrap-"));
    tempDirs.push(wsDir);
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: wsDir,
    });

    const resolved = await resolveOrCreateWorkspaceForPath(db, path.join(wsDir, "src"));

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

  it("refuses to auto-create a workspace at the user's home directory", async () => {
    const home = "/home/test-user";
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      await expect(resolveOrCreateWorkspaceForPath(db, home)).rejects.toThrow(/depot init/);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("refuses to auto-create a workspace at the filesystem root", async () => {
    await expect(resolveOrCreateWorkspaceForPath(db, "/")).rejects.toThrow(/depot init/);
  });

  it("still auto-creates a workspace in a non-git temp directory", async () => {
    const nonGitDir = await fs.mkdtemp(path.join(tmpdir(), "depot-non-git-"));
    tempDirs.push(nonGitDir);

    const resolved = await resolveOrCreateWorkspaceForPath(db, nonGitDir);

    expect(resolved.created).toBe(true);
    expect(resolved.workspace.path).toBe(nonGitDir);
    expect(resolved.workspace.projectId).toBe(resolved.project.id);
  });
});
