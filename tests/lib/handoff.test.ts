import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import {
  createProject,
  addWorkspace,
  createPrd,
  commitPrd,
  activatePrd,
  createTask,
  startTask,
  completeTask,
  blockTask,
  logActivity,
} from "#/lib/workflow";
import { buildHandoff } from "#/lib/handoff";

let db: Database;

beforeEach(async () => {
  const result = await createTestDb();
  db = result.db;
});

describe("handoff builder", () => {
  it("produces the header with project name and workspace path", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("=== DEPOT HANDOFF");
    expect(output).toContain("my-app");
    expect(output).toContain("/home/user/my-app");
  });

  it("includes a timestamp", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const output = await buildHandoff(db, ws.id);
    // Should contain an ISO-like timestamp
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("shows no-active-PRD message when no PRD is in_progress", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("No active PRD for this workspace");
    expect(output).toContain("depot prd list");
  });

  it("shows Active PRD section when a PRD is in_progress", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core Foundation",
      context: "Build the initial core",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Active PRD");
    expect(output).toContain("Core Foundation");
    expect(output).toContain("(revision 1)");
    expect(output).toContain("Build the initial core");
  });

  it("truncates context to 300 chars with ellipsis", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const longContext = "A".repeat(400);
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core",
      context: longContext,
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const output = await buildHandoff(db, ws.id);
    expect(output).not.toContain("A".repeat(400));
    expect(output).toContain("A".repeat(300));
    // Should end with ellipsis
    expect(output).toMatch(/A{300}\u2026/);
  });

  it("shows Task Progress summary", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const t1 = await createTask(db, {
      prdId: prd.id,
      title: "Task 1",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await createTask(db, {
      prdId: prd.id,
      title: "Task 2",
      description: "Desc",
      doneCriteria: "Done",
      effort: "s",
    });
    await startTask(db, t1.id);
    await completeTask(db, t1.id);

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Task Progress");
    expect(output).toContain("1/2 done");
  });

  it("shows Current Task section", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const task = await createTask(db, {
      prdId: prd.id,
      title: "Build workflow engine",
      description: "Desc",
      doneCriteria: "All tests pass\nCoverage > 80%",
      effort: "m",
    });
    await startTask(db, task.id);

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Current Task");
    expect(output).toContain("Build workflow engine");
    expect(output).toContain("Status    : in_progress");
    expect(output).toContain("All tests pass");
  });

  it("shows Blocked Tasks section", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const task = await createTask(db, {
      prdId: prd.id,
      title: "Deploy to prod",
      description: "Desc",
      doneCriteria: "Deployed",
      effort: "l",
    });
    await startTask(db, task.id);
    await blockTask(db, task.id, "Waiting for CI pipeline");

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Blocked Tasks");
    expect(output).toContain("Deploy to prod");
    expect(output).toContain("Waiting for CI pipeline");
  });

  it("shows Recent Activity section with last 10 entries", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });

    for (let i = 0; i < 15; i++) {
      await logActivity(db, {
        projectId: project.id,
        workspaceId: ws.id,
        eventType: "note",
        payload: { message: `Note ${i}` },
      });
    }

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Recent Activity");
    // Should show at most 10 entries
    expect(output).toContain("(last 10 entries)");
  });

  it("keeps recent activity scoped to the current workspace", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws1 = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const ws2 = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app-worktree",
    });

    await logActivity(db, {
      projectId: project.id,
      workspaceId: ws1.id,
      eventType: "note",
      payload: { message: "Workspace 1 note" },
    });
    await logActivity(db, {
      projectId: project.id,
      workspaceId: ws2.id,
      eventType: "note",
      payload: { message: "Workspace 2 note" },
    });

    const output = await buildHandoff(db, ws1.id);
    expect(output).toContain("Workspace 1 note");
    expect(output).not.toContain("Workspace 2 note");
  });

  it("shows Next Recommended Task when there is a pending task with satisfied deps", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    await createTask(db, {
      prdId: prd.id,
      title: "Next thing to do",
      description: "Desc",
      doneCriteria: "All good",
      effort: "s",
    });

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Next Recommended Task");
    expect(output).toContain("Next thing to do");
    expect(output).toContain("Dependencies: satisfied");
  });

  it("omits Next Recommended Task when no PRD is active", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });

    const output = await buildHandoff(db, ws.id);
    expect(output).not.toContain("## Next Recommended Task");
  });

  it("uses short IDs (first 8 chars)", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Core",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const output = await buildHandoff(db, ws.id);
    // The full ULID should not appear, only the short version
    expect(output).toContain(prd.id.slice(0, 8));
    expect(output).not.toContain(prd.id);
  });

  it("ends with Resume section", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });

    const output = await buildHandoff(db, ws.id);
    expect(output).toContain("## Resume");
    expect(output).toContain("depot playbook dev");
  });

  it("omits empty sections", async () => {
    const project = await createProject(db, { name: "my-app" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/user/my-app",
    });

    const output = await buildHandoff(db, ws.id);
    // No tasks, no current task, no blocked tasks, no activity
    expect(output).not.toContain("## Current Task");
    expect(output).not.toContain("## Blocked Tasks");
    expect(output).not.toContain("## Task Progress");
    expect(output).not.toContain("## Recent Activity");
  });
});
