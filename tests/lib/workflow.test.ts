import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import {
  createProject,
  listProjects,
  addWorkspace,
  resolveWorkspace,
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
  findPrdByPrefix,
  findTaskByPrefix,
} from "#/lib/workflow";

let db: Database;

beforeEach(async () => {
  const result = await createTestDb();
  db = result.db;
});

// ── Projects ────────────────────────────────────────────────────────────────

describe("projects", () => {
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
    ).rejects.toThrow();
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
    await expect(commitPrd(db, prd.id)).rejects.toThrow();
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
    await expect(activatePrd(db, prd.id)).rejects.toThrow();
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
    await expect(amendPrd(db, prd.id, { title: "v2" })).rejects.toThrow();
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
    ).rejects.toThrow();
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
    await expect(startTask(db, task.id)).rejects.toThrow();
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
    await expect(completeTask(db, task.id)).rejects.toThrow();
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
    await expect(blockTask(db, task.id, "")).rejects.toThrow();
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
    await expect(skipTask(db, task.id, "")).rejects.toThrow();
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
  });
});

// ── findPrdByPrefix ───────────────────────────────────────────────────────────

describe("findPrdByPrefix", () => {
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "Prefix Test Project" });
    projectId = project.id;
    const workspace = await addWorkspace(db, { projectId, path: "/prefix-test" });
    workspaceId = workspace.id;
  });

  it("finds a PRD by exact full ID", async () => {
    const prd = await createPrd(db, { projectId, workspaceId, title: "My PRD" });
    const found = await findPrdByPrefix(db, prd.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(prd.id);
  });

  it("finds a PRD by unique prefix", async () => {
    const prd = await createPrd(db, { projectId, workspaceId, title: "Prefix PRD" });
    // Use a prefix long enough to be unique (first 10 chars of a ULID is typically unique)
    const prefix = prd.id.slice(0, 10);
    const found = await findPrdByPrefix(db, prefix);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(prd.id);
  });

  it("returns null when no PRD matches", async () => {
    const found = await findPrdByPrefix(db, "nonexistent-prefix");
    expect(found).toBeNull();
  });
});

// ── findTaskByPrefix ──────────────────────────────────────────────────────────

describe("findTaskByPrefix", () => {
  let projectId: string;
  let workspaceId: string;
  let prdId: string;

  beforeEach(async () => {
    const project = await createProject(db, { name: "Task Prefix Project" });
    projectId = project.id;
    const workspace = await addWorkspace(db, { projectId, path: "/task-prefix-test" });
    workspaceId = workspace.id;
    const prd = await createPrd(db, { projectId, workspaceId, title: "PRD for tasks" });
    prdId = prd.id;
  });

  it("finds a task by exact full ID", async () => {
    const task = await createTask(db, {
      prdId,
      title: "My Task",
      description: "desc",
      doneCriteria: "done when done",
      effort: "s",
    });
    const found = await findTaskByPrefix(db, task.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
  });

  it("finds a task by unique prefix", async () => {
    const task = await createTask(db, {
      prdId,
      title: "Prefix Task",
      description: "desc",
      doneCriteria: "done when done",
      effort: "m",
    });
    const prefix = task.id.slice(0, 10);
    const found = await findTaskByPrefix(db, prefix);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(task.id);
  });

  it("returns null when no task matches", async () => {
    const found = await findTaskByPrefix(db, "nonexistent-prefix");
    expect(found).toBeNull();
  });
});
