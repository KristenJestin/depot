import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import { resolveMigrationsFolder } from "../helpers/db";
import type { Database } from "#/db/client";
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
  commitPrd,
  activatePrd,
  amendPrd,
  archivePrd,
  getPrd,
  listPrds,
  createTask,
  startTask,
  completeTask,
  blockTask,
  skipTask,
  listTasks,
  logActivity,
  listActivity,
  createReview,
  listReviews,
  startReview,
  recordReviewFindings,
  recordReviewDecision,
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
    await addWorkspace(db, {
      projectId: project.id,
      path: "D:\\Users\\Example\\Depot",
    });

    const resolved = await resolveWorkspace(db, "d:/users/example/depot/src/index.ts");
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(project.id);
    expect(resolved!.path).toBe("d:/users/example/depot");
  });

  it("resolves workspace from exact path", async () => {
    const project = await createProject(db, { name: "my-app" });
    await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const resolved = await resolveWorkspace(db, "/home/user/my-app");
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(project.id);
  });

  it("resolves workspace from nested subdirectory (longest prefix)", async () => {
    const project = await createProject(db, { name: "my-app" });
    await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const resolved = await resolveWorkspace(db, "/home/user/my-app/src/components");
    expect(resolved).not.toBeNull();
    expect(resolved!.projectId).toBe(project.id);
  });

  it("resolves the longest matching prefix when multiple workspaces match", async () => {
    const p1 = await createProject(db, { name: "parent" });
    const p2 = await createProject(db, { name: "nested" });
    await addWorkspace(db, { projectId: p1.id, path: "/home/user" });
    await addWorkspace(db, {
      projectId: p2.id,
      path: "/home/user/my-app",
    });
    const resolved = await resolveWorkspace(db, "/home/user/my-app/src/index.ts");
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
    await createPrd(db, { projectId: project.id, workspaceId: ws.id, title: "PRD" });
    await expect(removeWorkspace(db, ws.id)).rejects.toThrow(/linked PRD/);
  });

  it("force-removes a workspace and cascades linked PRDs and tasks", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, { projectId: project.id, path: "/home/user/my-app" });
    const prd = await createPrd(db, { projectId: project.id, workspaceId: ws.id, title: "PRD" });
    await createTask(db, {
      prdId: prd.id,
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
      workspaceId,
      title: "Core Foundation",
    });
    expect(prd.status).toBe("draft");
    expect(prd.revision).toBe(1);
    expect(prd.parentId).toBeNull();
  });

  it("creates a PRD with context and scope", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
      context: "Build the initial foundation",
      scope: "CLI + DB + workflow",
    });
    expect(prd.context).toBe("Build the initial foundation");
    expect(prd.scope).toBe("CLI + DB + workflow");
  });

  it("commits a draft PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    const committed = await commitPrd(db, prd.id);
    expect(committed.status).toBe("committed");
    expect(committed.committedAt).toBeTruthy();
  });

  it("rejects committing a non-draft PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    await commitPrd(db, prd.id);
    await expect(commitPrd(db, prd.id)).rejects.toThrow(/expected 'draft'/i);
  });

  it("activates a committed PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    await commitPrd(db, prd.id);
    const activated = await activatePrd(db, prd.id);
    expect(activated.status).toBe("in_progress");
    expect(activated.activatedAt).toBeTruthy();
  });

  it("rejects activating a non-committed PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    // still draft
    await expect(activatePrd(db, prd.id)).rejects.toThrow(/expected 'committed'/i);
  });

  it("rejects activating a second PRD in the same workspace", async () => {
    const prd1 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD B",
    });

    await commitPrd(db, prd1.id);
    await commitPrd(db, prd2.id);
    await activatePrd(db, prd1.id);

    await expect(activatePrd(db, prd2.id)).rejects.toThrow(/workspace already has active prd/i);
  });

  it("archives an in_progress PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);
    const archived = await archivePrd(db, prd.id);
    expect(archived.status).toBe("archived");
  });

  it("amends a committed PRD creating a new revision", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation v1",
      context: "initial",
    });
    await commitPrd(db, prd.id);
    const amended = await amendPrd(db, prd.id, {
      title: "Core Foundation v2",
      context: "updated",
    });
    expect(amended.parentId).toBe(prd.id);
    expect(amended.revision).toBe(2);
    expect(amended.title).toBe("Core Foundation v2");
    expect(amended.status).toBe("draft");
    // the original should be archived
    const original = await getPrd(db, prd.id);
    expect(original!.status).toBe("archived");
  });

  it("amends an in_progress PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);
    const amended = await amendPrd(db, prd.id, {
      title: "Core Foundation v2",
    });
    expect(amended.parentId).toBe(prd.id);
    expect(amended.revision).toBe(2);
  });

  it("rejects amending a draft PRD", async () => {
    const prd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Core Foundation",
    });
    await expect(amendPrd(db, prd.id, { title: "v2" })).rejects.toThrow(/expected 'committed' or 'in_progress'/i);
  });

  it("lists PRDs for a project", async () => {
    await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD A",
    });
    await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD B",
    });
    const list = await listPrds(db, { projectId });
    expect(list).toHaveLength(2);
  });

  it("allows multiple committed PRDs on the same project", async () => {
    const prd1 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD B",
    });
    await commitPrd(db, prd1.id);
    await commitPrd(db, prd2.id);
    const list = await listPrds(db, { projectId });
    const committed = list.filter((p) => p.status === "committed");
    expect(committed).toHaveLength(2);
  });

  it("allows multiple in_progress PRDs across different workspaces", async () => {
    const ws2 = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app-worktree",
    });
    const prd1 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      workspaceId: ws2.id,
      title: "PRD B",
    });
    await commitPrd(db, prd1.id);
    await commitPrd(db, prd2.id);
    await activatePrd(db, prd1.id);
    await activatePrd(db, prd2.id);
    const list = await listPrds(db, { projectId });
    const active = list.filter((p) => p.status === "in_progress");
    expect(active).toHaveLength(2);
  });
});

// ── Tasks ───────────────────────────────────────────────────────────────────

describe("task lifecycle", () => {
  let projectId: string;
  let workspaceId: string;
  let prdId: string;

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
      workspaceId,
      title: "Core Foundation",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);
    prdId = prd.id;
  });

  it("creates a task with pending status", async () => {
    const task = await createTask(db, {
      prdId,
      title: "Set up schema",
      description: "Create Drizzle schema for all tables",
      doneCriteria: "All tables exist with correct columns",
      effort: "m",
    });
    expect(task.status).toBe("pending");
    expect(task.position).toBe(1);
    expect(task.descriptionFormat).toBe("legacy");
  });

  it("stores structured task descriptions with an explicit format", async () => {
    const task = await createTask(db, {
      prdId,
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
      prdId,
      title: "Task 1",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const t2 = await createTask(db, {
      prdId,
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
        prdId,
        title: "Task",
        description: "Desc",
        doneCriteria: "",
        effort: "s",
      }),
    ).rejects.toThrow(/done_criteria/i);
  });

  it("starts a pending task", async () => {
    const task = await createTask(db, {
      prdId,
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
      prdId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, task.id);
    await expect(startTask(db, task.id)).rejects.toThrow(/expected 'pending'/i);
  });

  it("completes an in_progress task", async () => {
    const task = await createTask(db, {
      prdId,
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
      prdId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    // still pending
    await expect(completeTask(db, task.id)).rejects.toThrow(/expected 'in_progress'/i);
  });

  it("enforces dependency completion before task done", async () => {
    const dep = await createTask(db, {
      prdId,
      title: "Dependency",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const task = await createTask(db, {
      prdId,
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
      prdId,
      title: "Dependency",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    const task = await createTask(db, {
      prdId,
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
      prdId,
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
      prdId,
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
      prdId,
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
      prdId,
      title: "Task",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await expect(skipTask(db, task.id, "")).rejects.toThrow(/skip reason is required/i);
  });

  it("lists tasks for a PRD in position order", async () => {
    await createTask(db, {
      prdId,
      title: "Second",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await createTask(db, {
      prdId,
      title: "First",
      description: "Desc",
      doneCriteria: "Done",
      effort: "xs",
    });
    const list = await listTasks(db, prdId);
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe("Second");
    expect(list[1].title).toBe("First");
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
    const otherWorkspace = await addWorkspace(db, {
      projectId: otherProject.id,
      path: "/home/user/other-app",
    });
    const otherPrd = await createPrd(db, {
      projectId: otherProject.id,
      workspaceId: otherWorkspace.id,
      title: "Other PRD",
    });

    await expect(
      logActivity(db, {
        projectId,
        workspaceId,
        prdId: otherPrd.id,
        eventType: "note",
        payload: { message: "cross-project" },
      }),
    ).rejects.toThrow(/does not belong to project/i);
  });

  it("rejects logging a task that does not belong to the supplied PRD", async () => {
    const prd1 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD A",
    });
    const prd2 = await createPrd(db, {
      projectId,
      workspaceId,
      title: "PRD B",
    });
    const task = await createTask(db, {
      prdId: prd2.id,
      title: "Task B",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });

    await expect(
      logActivity(db, {
        projectId,
        workspaceId,
        prdId: prd1.id,
        taskId: task.id,
        eventType: "note",
        payload: { message: "wrong prd" },
      }),
    ).rejects.toThrow(/does not belong to prd/i);
  });
});

// ── Reviews ──────────────────────────────────────────────────────────────────

describe("review lifecycle", () => {
  let projectId: string;
  let workspaceId: string;
  let prdId: string;

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
      workspaceId,
      title: "Core Foundation",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);
    prdId = prd.id;
  });

  it("creates a review in pending status with autonomous mode", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    expect(review.status).toBe("pending");
    expect(review.mode).toBe("autonomous");
    expect(review.decision).toBeNull();
    expect(review.userFeedback).toBeNull();
    expect(review.prdRevision).toBe(1);
    expect(JSON.parse(review.findings)).toEqual([]);
  });

  it("creates an assisted review with user feedback", async () => {
    const review = await createReview(db, {
      prdId,
      mode: "assisted",
      userFeedback: "The auth flow seems too permissive",
    });
    expect(review.mode).toBe("assisted");
    expect(review.userFeedback).toBe("The auth flow seems too permissive");
  });

  it("starts a pending review setting status to in_progress", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    const started = await startReview(db, review.id);
    expect(started.status).toBe("in_progress");
  });

  it("rejects starting a non-pending review", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    await startReview(db, review.id);
    await expect(startReview(db, review.id)).rejects.toThrow(/expected 'pending'/i);
  });

  it("records findings with severity and description", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    const findings = [
      { title: "Missing input validation", severity: "major", description: "The API endpoint accepts unbounded input." },
    ];
    const updated = await recordReviewFindings(db, review.id, { findings });
    expect(JSON.parse(updated.findings)).toHaveLength(1);
    expect(updated.status).toBe("in_progress");
  });

  it("records questions and follow-up tasks alongside findings", async () => {
    const review = await createReview(db, { prdId, mode: "assisted" });
    const questions = [{ question: "Was error handling tested?", context: "task 2" }];
    const followupTasks = [{ title: "Add error handling test", description: "...", rationale: "..." }];
    const updated = await recordReviewFindings(db, review.id, {
      findings: [],
      questions,
      followupTasks,
    });
    expect(JSON.parse(updated.questions)).toHaveLength(1);
    expect(JSON.parse(updated.followupTasks)).toHaveLength(1);
  });

  it("rejects recording findings on a completed review", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    await recordReviewDecision(db, review.id, { decision: "approved" });
    await expect(
      recordReviewFindings(db, review.id, { findings: [] }),
    ).rejects.toThrow(/already completed/i);
  });

  it("records a human decision of approved and closes the review", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    const decided = await recordReviewDecision(db, review.id, { decision: "approved" });
    expect(decided.status).toBe("completed");
    expect(decided.decision).toBe("approved");
    expect(decided.completedAt).toBeTruthy();
  });

  it("records a changes_requested decision with a note", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    const decided = await recordReviewDecision(db, review.id, {
      decision: "changes_requested",
      note: "Rework the auth middleware",
    });
    expect(decided.decision).toBe("changes_requested");
    expect(decided.decisionNote).toBe("Rework the auth middleware");
  });

  it("rejects recording a decision on a completed review", async () => {
    const review = await createReview(db, { prdId, mode: "autonomous" });
    await recordReviewDecision(db, review.id, { decision: "approved" });
    await expect(
      recordReviewDecision(db, review.id, { decision: "rejected" }),
    ).rejects.toThrow(/already completed/i);
  });

  it("lists reviews for a PRD in creation order", async () => {
    const r1 = await createReview(db, { prdId, mode: "autonomous" });
    const r2 = await createReview(db, { prdId, mode: "assisted", userFeedback: "looks odd" });
    const list = await listReviews(db, prdId);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(r1.id);
    expect(list[1].id).toBe(r2.id);
  });

  it("allows multiple reviews across different revisions of the same PRD chain", async () => {
    // Use a separate workspace to avoid conflicts with the active PRD from beforeEach
    const ws2 = await addWorkspace(db, {
      projectId,
      path: "/home/user/my-app-review-test",
    });
    const prd = await createPrd(db, { projectId, workspaceId: ws2.id, title: "PRD v1" });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);
    await createReview(db, { prdId: prd.id, mode: "autonomous" });

    // Amend creates a new revision (archives old)
    const prdV2 = await amendPrd(db, prd.id, { title: "PRD v2" });
    await createReview(db, { prdId: prdV2.id, mode: "autonomous" });

    const reviewsV1 = await listReviews(db, prd.id);
    const reviewsV2 = await listReviews(db, prdV2.id);
    expect(reviewsV1).toHaveLength(1);
    expect(reviewsV2).toHaveLength(1);
    expect(reviewsV2[0].prdRevision).toBe(2);
  });

  it("rejects creating a review for a non-existent PRD", async () => {
    await expect(
      createReview(db, { prdId: "non-existent-id", mode: "autonomous" }),
    ).rejects.toThrow(/prd not found/i);
  });

  it("rejects logging a review that does not belong to the supplied PRD", async () => {
    const otherPrd = await createPrd(db, {
      projectId,
      workspaceId,
      title: "Other PRD",
    });
    const review = await createReview(db, { prdId, mode: "autonomous" });

    await expect(
      logActivity(db, {
        projectId,
        workspaceId,
        prdId: otherPrd.id,
        reviewId: review.id,
        eventType: "review_started",
        payload: {},
      }),
    ).rejects.toThrow(/does not belong to prd/i);
  });
});
