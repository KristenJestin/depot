import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestDb } from "../helpers/db";
import { resolveMigrationsFolder } from "../helpers/db";
import type { Database } from "#/db/client";
import { prdRevisions } from "#/db/schema";
import { resolveWorktreeMainPath, workspaceExistsOnDisk } from "#/modules/workspaces/domain";
import {
  createProject,
  listProjects,
  updateProject,
  addWorkspace,
  resolveWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspaceLabel,
  removeWorkspace,
  createPrd,
  activatePrd,
  getPrd,
  listPrds,
  markPrdReady,
  donePrd,
  forkPrd,
  loadPrd,
  reloadPrd,
  phaseAdvance,
  requestReviewPrd,
  createTask,
  startTask,
  completeTask,
  blockTask,
  skipTask,
  listTasks,
  logActivity,
  listActivity,
  listActivityForRevision,
} from "#/lib/workflow";

let db: Database;

beforeEach(async () => {
  const result = await createTestDb();
  db = result.db;
});

// ── Projects ────────────────────────────────────────────────────────────────

describe("projects", () => {
  it("uses the standard Drizzle migrations folder", () => {
    expect(resolveMigrationsFolder().replace(/\\/g, "/")).toMatch(/\/src\/db\/migrations$/);
  });

  it("creates a project with default status active", async () => {
    const project = await createProject(db, { name: "my-app" });
    expect(project.name).toBe("my-app");
    expect(project.status).toBe("active");
    expect(project.id).toBeTruthy();
  });

  it("creates a project with a description", async () => {
    const project = await createProject(db, {
      name: "my-app",
      description: "A cool app",
    });
    expect(project.description).toBe("A cool app");
  });

  it("lists all projects", async () => {
    await createProject(db, { name: "alpha" });
    await createProject(db, { name: "beta" });
    const list = await listProjects(db);
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("updates project name", async () => {
    const project = await createProject(db, { name: "old-name" });
    const updated = await updateProject(db, project.id, { name: "new-name" });
    expect(updated.name).toBe("new-name");
    expect(updated.status).toBe("active");
  });

  it("updates project status", async () => {
    const project = await createProject(db, { name: "my-app" });
    const updated = await updateProject(db, project.id, { status: "paused" });
    expect(updated.status).toBe("paused");
  });

  it("updates project description", async () => {
    const project = await createProject(db, { name: "my-app", description: "old" });
    const updated = await updateProject(db, project.id, { description: "new desc" });
    expect(updated.description).toBe("new desc");
  });

  it("throws when updating a non-existent project", async () => {
    await expect(updateProject(db, "nonexistent", { name: "x" })).rejects.toThrow(
      "Project not found",
    );
  });

  it("archives a project by setting status to done", async () => {
    const project = await createProject(db, { name: "finished" });
    const updated = await updateProject(db, project.id, { status: "done" });
    expect(updated.status).toBe("done");
  });
});

// ── Workspaces ──────────────────────────────────────────────────────────────

describe("workspaces", () => {
  // resolveWorkspace now masks workspaces whose path does not exist on disk,
  // so resolution tests need real directories instead of fixed fake paths.
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function createTempWorkspaceDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-resolve-test-"));
    tempDirs.push(dir);
    return dir;
  }

  it("adds a workspace to a project", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    expect(ws.projectId).toBe(project.id);
    expect(ws.path).toBe("/home/user/my-app");
  });

  it("adds a workspace with an optional label", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
      label: "main",
    });
    expect(ws.label).toBe("main");
  });

  it("rejects duplicate workspace paths", async () => {
    const project = await createProject(db, { name: "my-app" });
    await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    await expect(
      addWorkspace(db, {
        projectId: project.id,
        path: "/home/user/my-app",
      }),
    ).rejects.toThrow(/unique|constraint/i);
  });

  it("normalizes Windows workspace paths for matching", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const project = await createProject(db, { name: "my-app" });
    const wsDir = await createTempWorkspaceDir();
    await addWorkspace(db, {
      projectId: project.id,
      path: wsDir,
    });

    const lookupPath = path.join(wsDir.replace(/\\/g, "/").toLowerCase(), "src/index.ts");
    const resolved = await resolveWorkspace(db, lookupPath);
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(project.id);
    expect(resolved!.path).toBe(wsDir);
  });

  it("resolves workspace from exact path", async () => {
    const project = await createProject(db, { name: "my-app" });
    const wsDir = await createTempWorkspaceDir();
    await addWorkspace(db, { projectId: project.id, path: wsDir });
    const resolved = await resolveWorkspace(db, wsDir);
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(project.id);
  });

  it("resolves workspace from nested subdirectory (longest prefix)", async () => {
    const project = await createProject(db, { name: "my-app" });
    const wsDir = await createTempWorkspaceDir();
    await addWorkspace(db, { projectId: project.id, path: wsDir });
    const resolved = await resolveWorkspace(db, path.join(wsDir, "src/components"));
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(project.id);
  });

  it("resolves the longest matching prefix when multiple workspaces match", async () => {
    const p1 = await createProject(db, { name: "parent" });
    const p2 = await createProject(db, { name: "nested" });
    const parentDir = await createTempWorkspaceDir();
    const nestedDir = path.join(parentDir, "my-app");
    await fs.mkdir(nestedDir, { recursive: true });
    await addWorkspace(db, { projectId: p1.id, path: parentDir });
    await addWorkspace(db, { projectId: p2.id, path: nestedDir });
    const resolved = await resolveWorkspace(db, path.join(nestedDir, "src/index.ts"));
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(p2.id);
  });

  it("returns null when no workspace matches", async () => {
    const resolved = await resolveWorkspace(db, "/unregistered/path");
    expect(resolved).toBeNull();
  });

  it("lists all workspaces", async () => {
    const p1 = await createProject(db, { name: "a" });
    const p2 = await createProject(db, { name: "b" });
    await addWorkspace(db, { projectId: p1.id, path: "/home/user/a" });
    await addWorkspace(db, { projectId: p2.id, path: "/home/user/b" });
    const list = await listWorkspaces(db);
    expect(list).toHaveLength(2);
  });

  it("lists workspaces filtered by project", async () => {
    const p1 = await createProject(db, { name: "a" });
    const p2 = await createProject(db, { name: "b" });
    await addWorkspace(db, { projectId: p1.id, path: "/home/user/a" });
    await addWorkspace(db, { projectId: p2.id, path: "/home/user/b" });
    const list = await listWorkspaces(db, { projectId: p1.id });
    expect(list).toHaveLength(1);
    expect(list[0]!.projectId).toBe(p1.id);
  });

  it("gets a workspace by id", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/my-app" });
    const found = await getWorkspace(db, ws.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(ws.id);
  });

  it("returns null for non-existent workspace", async () => {
    const found = await getWorkspace(db, "nonexistent");
    expect(found).toBeNull();
  });

  it("updates workspace label", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/my-app" });
    const updated = await updateWorkspaceLabel(db, ws.id, "main");
    expect(updated.label).toBe("main");
  });

  it("throws when updating label for non-existent workspace", async () => {
    await expect(updateWorkspaceLabel(db, "nonexistent", "label")).rejects.toThrow(
      "Workspace not found",
    );
  });

  it("removes a workspace with no linked data", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/my-app" });
    await removeWorkspace(db, ws.id);
    const found = await getWorkspace(db, ws.id);
    expect(found).toBeNull();
  });

  it("blocks workspace removal when PRDs exist", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/my-app" });
    const prd = await createPrd(db, { projectId: project.id, title: "PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    await activatePrd(db, prd.id, ws.id);
    await expect(removeWorkspace(db, ws.id)).rejects.toThrow(/linked PRD/);
  });

  it("force-removes a workspace and cascades linked PRDs and tasks", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/my-app" });
    const prd = await createPrd(db, { projectId: project.id, title: "PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    await activatePrd(db, prd.id, ws.id);
    await createTask(db, {
      prdRevisionId: prd.id,
      title: "Task",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });
    await removeWorkspace(db, ws.id, true);
    const found = await getWorkspace(db, ws.id);
    expect(found).toBeNull();
    const remainingPrd = await getPrd(db, prd.id);
    expect(remainingPrd).toBeNull();
  });

  it("throws when removing non-existent workspace", async () => {
    await expect(removeWorkspace(db, "nonexistent")).rejects.toThrow("Workspace not found");
  });
});

// ── PRDs ────────────────────────────────────────────────────────────────────

describe("PRD lifecycle", () => {
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "my-app" });
    projectId = project.id;
    const ws = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app",
    });
    workspaceId = ws.id;
  });

  it("creates a PRD in draft status", async () => {
    const prd = await createPrd(db, {
      projectId,
      title: "Core Foundation",
    });
    expect(prd.status).toBe("draft");
    expect(prd.revision).toBe(1);
    expect(prd.prdId).toBeTruthy();
  });

  it("creates a PRD with context and scope", async () => {
    const prd = await createPrd(db, {
      projectId,
      title: "Core Foundation",
      context: "Build the initial foundation",
      scope: "CLI + DB + workflow",
    });
    expect(prd.context).toBe("Build the initial foundation");
    expect(prd.scope).toBe("CLI + DB + workflow");
  });

  it("activates a ready PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      title: "Core Foundation",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    const activated = await activatePrd(db, prd.id, workspaceId);
    expect(activated.status).toBe("in_progress");
    expect(activated.activatedAt).toBeTruthy();
  });

  it("rejects activating a non-ready PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      title: "Core Foundation",
    });
    // still draft
    await expect(activatePrd(db, prd.id, workspaceId)).rejects.toThrow(/invalid prd transition/i);
  });

  it("rejects activating a second PRD in the same workspace", async () => {
    const prd1 = await createPrd(db, {
      projectId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      title: "PRD B",
    });

    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd1.id));
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd2.id));
    await activatePrd(db, prd1.id, workspaceId);

    await expect(activatePrd(db, prd2.id, workspaceId)).rejects.toThrow(
      /workspace already has active prd/i,
    );
  });

  it("lists PRDs for a project", async () => {
    await createPrd(db, {
      projectId,
      title: "PRD A",
    });
    await createPrd(db, {
      projectId,
      title: "PRD B",
    });
    const list = await listPrds(db, { projectId });
    expect(list).toHaveLength(2);
  });

  it("allows multiple ready PRDs on the same project", async () => {
    const prd1 = await createPrd(db, {
      projectId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      title: "PRD B",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd1.id));
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd2.id));
    const list = await listPrds(db, { projectId });
    const ready = list.filter((p) => p.status === "ready");
    expect(ready).toHaveLength(2);
  });

  it("allows multiple in_progress PRDs across different workspaces", async () => {
    const ws2 = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app-worktree",
    });
    const prd1 = await createPrd(db, {
      projectId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      title: "PRD B",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd1.id));
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd2.id));
    await activatePrd(db, prd1.id, workspaceId);
    await activatePrd(db, prd2.id, ws2.id);
    const list = await listPrds(db, { projectId });
    const active = list.filter((p) => p.status === "in_progress");
    expect(active).toHaveLength(2);
  });

  it("auto-logs prd_ready when a PRD is marked ready", async () => {
    const prd = await createPrd(db, { projectId, title: "My PRD" });
    await markPrdReady(db, prd.id);
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "prd_ready");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.prdRevisionId).toBe(prd.id);
    expect(payload.title).toBe("My PRD");
  });

  it("auto-logs prd_activated when a PRD is activated", async () => {
    const prd = await createPrd(db, { projectId, title: "My PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    await activatePrd(db, prd.id, workspaceId);
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "prd_activated");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.prdRevisionId).toBe(prd.id);
    expect(payload.title).toBe("My PRD");
  });

  it("auto-logs prd_done when a PRD is marked done", async () => {
    const prd = await createPrd(db, { projectId, title: "My PRD" });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    await activatePrd(db, prd.id, workspaceId);
    // Reach `done` via the human-review gate — `in_progress → done` is no
    // longer a legal transition.
    await requestReviewPrd(db, prd.id);
    await donePrd(db, prd.id);
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "prd_done");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.prdRevisionId).toBe(prd.id);
    expect(payload.title).toBe("My PRD");
  });

  it("auto-logs prd_forked with sourcePrdId and newPrdId when a PRD is forked", async () => {
    const prd = await createPrd(db, { projectId, title: "My PRD" });
    await markPrdReady(db, prd.id);
    const forked = await forkPrd(db, prd.id);
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "prd_forked");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.sourcePrdRevisionId).toBe(prd.id);
    expect(payload.newPrdRevisionId).toBe(forked.id);
    expect(payload.revision).toBe(2);
  });
});

// ── Tasks ───────────────────────────────────────────────────────────────────

describe("task lifecycle", () => {
  let projectId: string;
  let workspaceId: string;
  let prdRevisionId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "my-app" });
    projectId = project.id;
    const ws = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app",
    });
    workspaceId = ws.id;
    const prd = await createPrd(db, {
      projectId,
      title: "Core Foundation",
    });
    await db.update(prdRevisions).set({ status: "ready" }).where(eq(prdRevisions.id, prd.id));
    await activatePrd(db, prd.id, workspaceId);
    prdRevisionId = prd.id;
  });

  it("creates a task with pending status", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Set up schema",
      description: "Create Drizzle schema for all tables",
      doneCriteria: "All tables exist with correct columns",
      effort: "m",
    });
    expect(task.status).toBe("pending");
    expect(task.position).toBe(1);
    expect(task.descriptionFormat).toBe("structured_v1");
  });

  it("stores structured task descriptions with an explicit format", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Structured task",
      description: [
        "Intent:",
        "Clarify the task intent for execution.",
        "",
        "Scope:",
        "Render structured specs in task show",
        "Keep old descriptions readable",
        "",
        "Non-goals:",
        "Do not require legacy task rewrites",
      ].join("\n"),
      doneCriteria: "Structured output is readable",
      effort: "m",
    });

    expect(task.descriptionFormat).toBe("structured_v1");
    expect(task.description).toContain("Intent:");
    expect(task.description).toContain("- Render structured specs in task show");
    expect(task.description).toContain("Non-goals:");
  });

  it("auto-increments position within a PRD", async () => {
    const t1 = await createTask(db, {
      prdRevisionId,
      title: "Task 1",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const t2 = await createTask(db, {
      prdRevisionId,
      title: "Task 2",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    expect(t1.position).toBe(1);
    expect(t2.position).toBe(2);
  });

  it("rejects creating a task with empty done_criteria", async () => {
    await expect(
      createTask(db, {
        prdRevisionId,
        title: "Task",
        description: "Desc",
        doneCriteria: "",
        effort: "s",
      }),
    ).rejects.toThrow(/done_criteria/i);
  });

  it("starts a pending task", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const started = await startTask(db, task.id);
    expect(started.status).toBe("in_progress");
    expect(started.startedAt).toBeTruthy();
  });

  it("rejects starting a non-pending task", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    await expect(startTask(db, task.id)).rejects.toThrow(/invalid task transition/i);
  });

  it("completes an in_progress task", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Tests pass",
      effort: "s",
    });
    await startTask(db, task.id);
    const done = await completeTask(db, task.id);
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeTruthy();
  });

  it("rejects completing a non-in_progress task", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    // still pending
    await expect(completeTask(db, task.id)).rejects.toThrow(/invalid task transition/i);
  });

  it("enforces dependency completion before task done", async () => {
    const dep = await createTask(db, {
      prdRevisionId,
      title: "Dependency",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const task = await createTask(db, {
      prdRevisionId,
      title: "Dependent",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
      dependsOn: [dep.id],
    });
    await startTask(db, task.id);
    // dep is still pending => completeTask should fail
    await expect(completeTask(db, task.id)).rejects.toThrow(/dependenc/i);
  });

  it("allows completion when all dependencies are done", async () => {
    const dep = await createTask(db, {
      prdRevisionId,
      title: "Dependency",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const task = await createTask(db, {
      prdRevisionId,
      title: "Dependent",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
      dependsOn: [dep.id],
    });
    // Complete the dependency first
    await startTask(db, dep.id);
    await completeTask(db, dep.id);
    // Now the dependent task should be completable
    await startTask(db, task.id);
    const done = await completeTask(db, task.id);
    expect(done.status).toBe("done");
  });

  it("blocks an in_progress task with a reason", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    const blocked = await blockTask(db, task.id, "Waiting for API access");
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedReason).toBe("Waiting for API access");
  });

  it("rejects blocking without a reason", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    await expect(blockTask(db, task.id, "")).rejects.toThrow(/block reason is required/i);
  });

  it("skips a pending task with a reason", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const skipped = await skipTask(db, task.id, "Not relevant anymore");
    expect(skipped.status).toBe("skipped");
    expect(skipped.skipReason).toBe("Not relevant anymore");
  });

  it("rejects skipping without a reason", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await expect(skipTask(db, task.id, "")).rejects.toThrow(/skip reason is required/i);
  });

  it("lists tasks for a PRD in position order", async () => {
    await createTask(db, {
      prdRevisionId,
      title: "Second",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await createTask(db, {
      prdRevisionId,
      title: "First",
      description: "Desc",
      doneCriteria: "Done",
      effort: "xs",
    });
    const list = await listTasks(db, prdRevisionId);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe("Second");
    expect(list[1].title).toBe("First");
  });

  it("auto-logs task_started when a task is started", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "My Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "task_started");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.taskId).toBe(task.id);
    expect(payload.title).toBe("My Task");
  });

  it("auto-logs task_done when a task is completed", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "My Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    await completeTask(db, task.id);
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "task_done");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.taskId).toBe(task.id);
    expect(payload.title).toBe("My Task");
  });

  it("auto-logs task_blocked with reason when a task is blocked", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "My Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    await blockTask(db, task.id, "Waiting on design");
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "task_blocked");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.taskId).toBe(task.id);
    expect(payload.title).toBe("My Task");
    expect(payload.reason).toBe("Waiting on design");
  });

  it("auto-logs task_skipped with reason when a task is skipped", async () => {
    const task = await createTask(db, {
      prdRevisionId,
      title: "My Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await skipTask(db, task.id, "No longer needed");
    const log = await listActivity(db, { projectId });
    const entry = log.find((e) => e.eventType === "task_skipped");
    expect(entry).toBeDefined();
    const payload = JSON.parse(entry!.payload);
    expect(payload.taskId).toBe(task.id);
    expect(payload.title).toBe("My Task");
    expect(payload.reason).toBe("No longer needed");
  });
});

// ── Activity Log ────────────────────────────────────────────────────────────

describe("activity log", () => {
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "my-app" });
    projectId = project.id;
    const ws = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app",
    });
    workspaceId = ws.id;
  });

  it("logs a session_start event", async () => {
    const entry = await logActivity(db, {
      projectId,
      workspaceId,
      eventType: "session_start",
      payload: { context: "Starting new session" },
    });
    expect(entry.eventType).toBe("session_start");
    expect(JSON.parse(entry.payload)).toEqual({
      context: "Starting new session",
    });
  });

  it("logs a note event", async () => {
    const entry = await logActivity(db, {
      projectId,
      eventType: "note",
      payload: { message: "Important observation" },
    });
    expect(entry.eventType).toBe("note");
  });

  it("lists activity in chronological order", async () => {
    await logActivity(db, {
      projectId,
      eventType: "session_start",
      payload: {},
    });
    await logActivity(db, {
      projectId,
      eventType: "note",
      payload: { message: "hello" },
    });
    const list = await listActivity(db, { projectId });
    expect(list).toHaveLength(2);
    expect(list[0].eventType).toBe("session_start");
    expect(list[1].eventType).toBe("note");
  });

  it("filters activity by last N entries", async () => {
    for (let i = 0; i < 15; i++) {
      await logActivity(db, {
        projectId,
        eventType: "note",
        payload: { message: `Note ${i}` },
      });
    }
    const last5 = await listActivity(db, { projectId, limit: 5 });
    expect(last5).toHaveLength(5);
    expect(JSON.parse(last5[0]!.payload)).toEqual({ message: "Note 10" });
    expect(JSON.parse(last5[4]!.payload)).toEqual({ message: "Note 14" });
  });

  it("filters activity by workspace within a project", async () => {
    const otherWorkspace = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app-worktree",
    });

    await logActivity(db, {
      projectId,
      workspaceId,
      eventType: "note",
      payload: { message: "main workspace" },
    });
    await logActivity(db, {
      projectId,
      workspaceId: otherWorkspace.id,
      eventType: "note",
      payload: { message: "other workspace" },
    });

    const entries = await listActivity(db, { projectId, workspaceId });
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0]!.payload)).toEqual({ message: "main workspace" });
  });

  it("rejects logging a PRD from another project", async () => {
    const otherProject = await createProject(db, { name: "other-app" });
    const _otherWorkspace = await addWorkspace(db, {
      projectId: otherProject.id,
      path: "/home/user/other-app",
    });
    const otherPrd = await createPrd(db, {
      projectId: otherProject.id,
      title: "Other PRD",
    });

    await expect(
      logActivity(db, {
        projectId,
        workspaceId,
        prdRevisionId: otherPrd.id,
        eventType: "note",
        payload: { message: "cross-project" },
      }),
    ).rejects.toThrow(/does not belong to project/i);
  });

  it("rejects logging a task that does not belong to the supplied PRD", async () => {
    const prd1 = await createPrd(db, {
      projectId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      title: "PRD B",
    });
    const task = await createTask(db, {
      prdRevisionId: prd2.id,
      title: "Task B",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });

    await expect(
      logActivity(db, {
        projectId,
        workspaceId,
        prdRevisionId: prd1.id,
        taskId: task.id,
        eventType: "note",
        payload: { message: "wrong prd" },
      }),
    ).rejects.toThrow(/does not belong to prd/i);
  });
});

// ── loadPrd ──────────────────────────────────────────────────────────────────

describe("loadPrd", () => {
  let projectId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "load-test-app" });
    projectId = project.id;
  });

  it("creates a PRD in draft with tasks", async () => {
    const { prd, tasks } = await loadPrd(db, {
      projectId,
      title: "Batch PRD",
      ready: false,
      tasks: [
        {
          title: "Task A",
          description: "Desc A",
          doneCriteria: "Done A",
          effort: "s",
          dependsOn: [],
        },
        {
          title: "Task B",
          description: "Desc B",
          doneCriteria: "Done B",
          effort: "m",
          dependsOn: [],
        },
      ],
    });
    expect(prd.title).toBe("Batch PRD");
    expect(prd.status).toBe("draft");
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toBe("Task A");
    expect(tasks[1]!.title).toBe("Task B");
    expect(tasks[0]!.position).toBe(1);
    expect(tasks[1]!.position).toBe(2);
  });

  it("marks PRD as ready when ready:true", async () => {
    const { prd, tasks } = await loadPrd(db, {
      projectId,
      title: "Ready PRD",
      ready: true,
      tasks: [
        { title: "Task 1", description: "Desc", doneCriteria: "Done", effort: "xs", dependsOn: [] },
      ],
    });
    expect(prd.status).toBe("ready");
    expect(tasks).toHaveLength(1);
  });

  it("resolves dependsOn indices to task IDs", async () => {
    const { tasks } = await loadPrd(db, {
      projectId,
      title: "Deps PRD",
      ready: false,
      tasks: [
        { title: "Task 0", description: "Desc", doneCriteria: "Done", effort: "s", dependsOn: [] },
        { title: "Task 1", description: "Desc", doneCriteria: "Done", effort: "m", dependsOn: [0] },
      ],
    });
    expect(tasks).toHaveLength(2);
    const task1Deps: string[] = JSON.parse(tasks[1]!.dependsOn);
    expect(task1Deps).toEqual([tasks[0]!.id]);
  });

  it("keeps PRD in draft when ready:false", async () => {
    const { prd } = await loadPrd(db, {
      projectId,
      title: "Draft PRD",
      ready: false,
      tasks: [{ title: "T", description: "D", doneCriteria: "C", effort: "xs", dependsOn: [] }],
    });
    expect(prd.status).toBe("draft");
  });

  it("rolls back the entire batch if a task insert fails", async () => {
    let callCount = 0;
    const originalTransaction = db.transaction.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(db, "transaction").mockImplementationOnce((fn: (tx: any) => unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalTransaction((tx: any) => {
        const originalInsert = tx.insert.bind(tx);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(tx, "insert").mockImplementation((table: any) => {
          callCount += 1;
          if (callCount > 1) {
            throw new Error("Simulated task insert failure");
          }
          return originalInsert(table);
        });
        return fn(tx);
      });
    });

    await expect(
      loadPrd(db, {
        projectId,
        title: "Rollback PRD",
        ready: false,
        tasks: [
          { title: "Task A", description: "D", doneCriteria: "C", effort: "s", dependsOn: [] },
        ],
      }),
    ).rejects.toThrow(/Simulated task insert failure|DatabaseError/i);

    const allPrds = await db.query.prdRevisions.findMany({ where: { projectId } });
    expect(allPrds.find((p) => p.title === "Rollback PRD")).toBeUndefined();
  });
});

// ── reloadPrd ──────────────────────────────────────────────────────────────

describe("reloadPrd", () => {
  let projectId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "reload-test" });
    projectId = project.id;
  });

  it("replaces title, context, scope, and tasks while preserving the PRD id", async () => {
    const { prd: original } = await loadPrd(db, {
      projectId,
      title: "Original Title",
      context: "Old context",
      scope: "Old scope",
      ready: false,
      tasks: [
        {
          title: "Old Task",
          description: "Old desc",
          doneCriteria: "Old done",
          effort: "s",
          dependsOn: [],
        },
      ],
    });

    const { prd: reloaded, tasks: newTasks } = await reloadPrd(db, {
      prdRevisionId: original.id,
      title: "New Title",
      context: "New context",
      scope: "New scope",
      tasks: [
        {
          title: "Task A",
          description: "Desc A",
          doneCriteria: "Done A",
          effort: "m",
          dependsOn: [],
        },
        {
          title: "Task B",
          description: "Desc B",
          doneCriteria: "Done B",
          effort: "s",
          dependsOn: [0],
        },
      ],
    });

    expect(reloaded.id).toBe(original.id);
    expect(reloaded.title).toBe("New Title");
    expect(reloaded.context).toBe("New context");
    expect(reloaded.scope).toBe("New scope");
    expect(reloaded.status).toBe("draft");
    expect(newTasks).toHaveLength(2);
    expect(newTasks[0]!.title).toBe("Task A");
    expect(newTasks[1]!.title).toBe("Task B");
    const deps: string[] = JSON.parse(newTasks[1]!.dependsOn);
    expect(deps).toEqual([newTasks[0]!.id]);
  });

  it("fails with PrdNotDraftError when the PRD is not in draft status", async () => {
    const { prd } = await loadPrd(db, {
      projectId,
      title: "Ready PRD",
      ready: true,
      tasks: [{ title: "T", description: "D", doneCriteria: "C", effort: "s", dependsOn: [] }],
    });

    await expect(
      reloadPrd(db, {
        prdRevisionId: prd.id,
        title: "Updated",
        tasks: [{ title: "T", description: "D", doneCriteria: "C", effort: "s", dependsOn: [] }],
      }),
    ).rejects.toThrow(/prd_not_draft|Only draft PRDs/i);
  });

  it("all new tasks start with status pending", async () => {
    const { prd } = await loadPrd(db, {
      projectId,
      title: "PRD",
      ready: false,
      tasks: [{ title: "Old", description: "D", doneCriteria: "C", effort: "s", dependsOn: [] }],
    });

    const { tasks: newTasks } = await reloadPrd(db, {
      prdRevisionId: prd.id,
      title: "PRD",
      tasks: [{ title: "New", description: "D", doneCriteria: "C", effort: "s", dependsOn: [] }],
    });

    expect(newTasks.every((t) => t.status === "pending")).toBe(true);
  });
});

// ── resolveWorktreeMainPath ────────────────────────────────────────────────

describe("resolveWorktreeMainPath", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-worktree-test-"));
    tempDirs.push(dir);
    return dir;
  }

  it("returns the main repo path from a worktree .git file", async () => {
    const mainRepo = await createTempDir();
    const worktreeDir = await createTempDir();
    const worktreesDir = path.join(mainRepo, ".git", "worktrees", "test");
    await fs.mkdir(worktreesDir, { recursive: true });
    const gitdir = path.join(mainRepo, ".git", "worktrees", "test");
    await fs.writeFile(path.join(worktreeDir, ".git"), `gitdir: ${gitdir}\n`);

    const result = await Effect.runPromise(resolveWorktreeMainPath(worktreeDir));
    expect(result?.replace(/\\/g, "/")).toBe(mainRepo.replace(/\\/g, "/"));
  });

  it("returns null when no .git file is found", async () => {
    const dir = await createTempDir();
    expect(await Effect.runPromise(resolveWorktreeMainPath(dir))).toBeNull();
  });

  it("returns null when .git is a directory (normal repo)", async () => {
    const dir = await createTempDir();
    await fs.mkdir(path.join(dir, ".git"), { recursive: true });
    expect(await Effect.runPromise(resolveWorktreeMainPath(dir))).toBeNull();
  });

  it("returns null when .git file points to a submodule gitdir (no /worktrees/)", async () => {
    const mainRepo = await createTempDir();
    const submoduleDir = await createTempDir();
    const gitdir = path.join(mainRepo, ".git", "modules", "sub");
    await fs.mkdir(gitdir, { recursive: true });
    await fs.writeFile(path.join(submoduleDir, ".git"), `gitdir: ${gitdir}\n`);

    expect(await Effect.runPromise(resolveWorktreeMainPath(submoduleDir))).toBeNull();
  });
});

// ── workspaceExistsOnDisk ──────────────────────────────────────────────────

describe("workspaceExistsOnDisk", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-orphan-test-"));
    tempDirs.push(dir);
    return dir;
  }

  it("returns true when the workspace path exists on disk", async () => {
    const dir = await createTempDir();
    expect(workspaceExistsOnDisk({ path: dir })).toBe(true);
  });

  it("returns false when the workspace path no longer exists", async () => {
    const dir = await createTempDir();
    await fs.rm(dir, { recursive: true, force: true });
    expect(workspaceExistsOnDisk({ path: dir })).toBe(false);
  });

  it("returns false without throwing when fs.stat errors on the path", async () => {
    // Traversing through a regular file produces an ENOTDIR — distinct from
    // the plain ENOENT case above. The helper must swallow any fs error.
    const dir = await createTempDir();
    const filePath = path.join(dir, "regular-file");
    await fs.writeFile(filePath, "hello");
    const bogus = path.join(filePath, "nested");
    expect(() => workspaceExistsOnDisk({ path: bogus })).not.toThrow();
    expect(workspaceExistsOnDisk({ path: bogus })).toBe(false);
  });
});

// ── resolveWorkspace orphan masking ────────────────────────────────────────

describe("resolveWorkspace orphan masking", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-orphan-resolve-"));
    tempDirs.push(dir);
    return dir;
  }

  it("ignores a workspace whose path was deleted on disk", async () => {
    const project = await createProject(db, { name: "ghost-app" });
    const wsDir = await createTempDir();
    await addWorkspace(db, { projectId: project.id, path: wsDir });
    await fs.rm(wsDir, { recursive: true, force: true });

    const resolved = await resolveWorkspace(db, wsDir);
    expect(resolved).toBeNull();
  });

  it("falls back to the next longest-prefix candidate when the best match is orphan", async () => {
    const parent = await createProject(db, { name: "parent" });
    const nested = await createProject(db, { name: "nested" });

    const parentDir = await createTempDir();
    const nestedDir = path.join(parentDir, "nested-app");
    await fs.mkdir(nestedDir, { recursive: true });

    await addWorkspace(db, { projectId: parent.id, path: parentDir });
    await addWorkspace(db, { projectId: nested.id, path: nestedDir });

    // Delete only the nested workspace — parent stays valid.
    await fs.rm(nestedDir, { recursive: true, force: true });

    const resolved = await resolveWorkspace(db, path.join(nestedDir, "src/index.ts"));
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(parent.id);
  });
});

// ── resolveWorkspace resolution order ──────────────────────────────────────

describe("resolveWorkspace resolution order", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function createTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-resolve-order-"));
    tempDirs.push(dir);
    return dir;
  }

  it("prefers a worktree fallback over a too-broad ancestor workspace", async () => {
    // A workspace registered at a broad path (e.g. ~) must not shadow a
    // worktree whose main repo belongs to another registered project.
    const ancestor = await createProject(db, { name: "too-broad" });
    const real = await createProject(db, { name: "real-project" });

    const ancestorDir = await createTempDir();
    const mainRepoDir = path.join(ancestorDir, "real-project");
    await fs.mkdir(mainRepoDir, { recursive: true });

    const worktreeDir = path.join(ancestorDir, "worktree", "feature");
    await fs.mkdir(worktreeDir, { recursive: true });
    const gitdir = path.join(mainRepoDir, ".git", "worktrees", "feature");
    await fs.mkdir(gitdir, { recursive: true });
    await fs.writeFile(path.join(worktreeDir, ".git"), `gitdir: ${gitdir}\n`);

    await addWorkspace(db, { projectId: ancestor.id, path: ancestorDir });
    await addWorkspace(db, { projectId: real.id, path: mainRepoDir });

    const resolved = await resolveWorkspace(db, worktreeDir);
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(real.id);
  });

  it("returns the exact-match workspace even when a worktree fallback would resolve to another project", async () => {
    // An exact cwd match must win unconditionally — the worktree fallback
    // is only attempted when the cwd is below (not equal to) a registered path.
    const exact = await createProject(db, { name: "exact" });
    const other = await createProject(db, { name: "other" });

    const exactDir = await createTempDir();
    const otherMainRepo = await createTempDir();

    const gitdir = path.join(otherMainRepo, ".git", "worktrees", "feature");
    await fs.mkdir(gitdir, { recursive: true });
    await fs.writeFile(path.join(exactDir, ".git"), `gitdir: ${gitdir}\n`);

    await addWorkspace(db, { projectId: exact.id, path: exactDir });
    await addWorkspace(db, { projectId: other.id, path: otherMainRepo });

    const resolved = await resolveWorkspace(db, exactDir);
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(exact.id);
  });

  it("falls back to an ancestor match only when no worktree fallback resolves", async () => {
    // No worktree at all — the longest-prefix ancestor must still win.
    const parent = await createProject(db, { name: "parent" });

    const parentDir = await createTempDir();
    const nestedDir = path.join(parentDir, "sub", "deep");
    await fs.mkdir(nestedDir, { recursive: true });

    await addWorkspace(db, { projectId: parent.id, path: parentDir });

    const resolved = await resolveWorkspace(db, nestedDir);
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(parent.id);
  });
});

// ── phaseAdvance activity log ─────────────────────────────────────────────────

describe("phaseAdvance activity log", () => {
  it("emits a phase_advanced activity entry with fromPhase and toPhase", async () => {
    const project = await createProject(db, { name: "phase-test" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      label: "main",
      path: "/tmp/phase-test",
    });

    // Create a phased PRD with two phases
    const { prd: rev } = await loadPrd(db, {
      projectId: project.id,
      title: "Phased PRD",
      ready: true,
      tasks: [
        {
          title: "Phase 1 task",
          description: "Do phase 1",
          doneCriteria: "Phase 1 done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 1,
        },
        {
          title: "Phase 2 task",
          description: "Do phase 2",
          doneCriteria: "Phase 2 done",
          effort: "s",
          dependsOn: [],
          phaseNumber: 2,
        },
      ],
    });

    await activatePrd(db, rev.id, ws.id);

    // Complete phase 1 task so phaseAdvance is allowed
    const taskList = await listTasks(db, rev.id);
    const phase1Task = taskList.find((t) => t.phaseNumber === 1)!;
    await startTask(db, phase1Task.id);
    await completeTask(db, phase1Task.id);

    // phaseAdvance now requires the human-review gate to be open first.
    await requestReviewPrd(db, rev.id);
    await phaseAdvance(db, rev.id);

    const activity = await listActivityForRevision(db, rev.id);
    const phaseEntry = activity.find((e) => e.eventType === "phase_advanced");
    expect(phaseEntry).toBeDefined();
    const payload = JSON.parse(phaseEntry!.payload) as { fromPhase: number; toPhase: number };
    expect(payload.fromPhase).toBe(1);
    expect(payload.toPhase).toBe(2);
  });
});
