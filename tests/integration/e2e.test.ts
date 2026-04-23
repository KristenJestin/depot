import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prds } from "#/db/schema";
import {
  createProject,
  addWorkspace,
  resolveWorkspace,
  createPrd,
  activatePrd,
  createTask,
  startTask,
  completeTask,
  blockTask,
  skipTask,
  logActivity,
  listActivity,
  listTasks,
  getPrd,
} from "#/lib/workflow";

/**
 * End-to-end integration test: simulates a complete agent workflow
 * from project init through PRD creation and task execution.
 */
describe("end-to-end workflow", () => {
  let db: Database;

  beforeEach(async () => {
    const result = await createTestDb();
    db = result.db;
  });

  it("runs a complete agent session lifecycle", async () => {
    // 1. Agent initializes project
    const project = await createProject(db, {
      name: "depot",
      description: "AI agent task management CLI",
    });
    expect(project.status).toBe("active");

    // 2. Agent links workspace
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/depot",
      label: "main",
    });

    // 3. Workspace resolves from nested path
    const resolved = await resolveWorkspace(db, "/home/agent/depot/src/lib/workflow.ts");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(ws.id);

    // 4. Agent creates a PRD
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Core Foundation",
      context: "Build the initial CLI foundation",
      scope: "DB, workflow, CLI",
    });
    expect(prd.status).toBe("draft");

    // 5. Agent marks the PRD ready
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    const readyPrd = (await getPrd(db, prd.id))!;
    expect(readyPrd.status).toBe("ready");

    // 6. Agent activates the PRD
    const activated = await activatePrd(db, prd.id, ws.id);
    expect(activated.status).toBe("in_progress");

    // 7. Agent creates tasks
    const t1 = await createTask(db, {
      prdId: prd.id,
      title: "Set up database schema",
      description: "Create all tables with Drizzle",
      doneCriteria: "All 5 tables exist\nMigrations run clean",
      effort: "m",
    });
    const t2 = await createTask(db, {
      prdId: prd.id,
      title: "Implement workflow engine",
      description: "Core business logic for state transitions",
      doneCriteria: "All transition tests pass",
      effort: "l",
      dependsOn: [t1.id],
    });
    const t3 = await createTask(db, {
      prdId: prd.id,
      title: "Build context command",
      description: "Structured plaintext output for agent resume",
      doneCriteria: "Context output matches spec format",
      effort: "m",
      dependsOn: [t2.id],
    });

    // 8. Agent logs session start
    await logActivity(db, {
      projectId: project.id,
      workspaceId: ws.id,
      eventType: "session_start",
      payload: { context: "Initial development session" },
    });

    // 9. Agent works through tasks
    await startTask(db, t1.id);
    await logActivity(db, {
      projectId: project.id,
      workspaceId: ws.id,
      taskId: t1.id,
      eventType: "task_started",
      payload: { task_id: t1.id, title: t1.title },
    });

    await completeTask(db, t1.id);
    await logActivity(db, {
      projectId: project.id,
      workspaceId: ws.id,
      taskId: t1.id,
      eventType: "task_done",
      payload: { task_id: t1.id, title: t1.title },
    });

    // 10. Start task 2
    await startTask(db, t2.id);

    // 11. Check mid-session state
    const midTasks = await listTasks(db, prd.id);
    expect(midTasks.find((t) => t.id === t1.id)!.status).toBe("done");
    expect(midTasks.find((t) => t.id === t2.id)!.status).toBe("in_progress");

    // 12. Complete task 2
    await completeTask(db, t2.id);

    // 13. Start and complete task 3
    await startTask(db, t3.id);
    await completeTask(db, t3.id);

    // 14. All tasks done
    const finalTasks = await listTasks(db, prd.id);
    expect(finalTasks.every((t) => t.status === "done")).toBe(true);
    expect(finalTasks).toHaveLength(3);
  });

  it("handles task blocking and unblocking flow", async () => {
    const project = await createProject(db, { name: "my-project" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/my-project",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Feature Y",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    await activatePrd(db, prd.id, ws.id);

    const task = await createTask(db, {
      prdId: prd.id,
      title: "Deploy",
      description: "Deploy to production",
      doneCriteria: "Service is running",
      effort: "l",
    });

    // Start and block
    await startTask(db, task.id);
    const blocked = await blockTask(db, task.id, "CI is broken");
    expect(blocked.status).toBe("blocked");

    // Skip the blocked task
    const skipped = await skipTask(db, task.id, "Decided to defer deployment");
    expect(skipped.status).toBe("skipped");
  });

  it("handles multiple workspaces for the same project", async () => {
    const project = await createProject(db, { name: "monorepo" });
    const ws1 = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/monorepo",
      label: "main",
    });
    const ws2 = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/monorepo-worktree",
      label: "feature-branch",
    });

    // Each workspace gets its own PRD
    const prd1 = await createPrd(db, {
      projectId: project.id,
      title: "Backend refactor",
    });
    const prd2 = await createPrd(db, {
      projectId: project.id,
      title: "New feature",
    });

    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd1.id));
    const activated1 = await activatePrd(db, prd1.id, ws1.id);
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd2.id));
    const activated2 = await activatePrd(db, prd2.id, ws2.id);

    // Each workspace has its own isolated active PRD
    expect(activated1.workspaceId).toBe(ws1.id);
    expect(activated2.workspaceId).toBe(ws2.id);

    // Each workspace has its own active PRD
    const ws1Tasks = await listTasks(db, prd1.id);
    const ws2Tasks = await listTasks(db, prd2.id);
    expect(ws1Tasks).toHaveLength(0);
    expect(ws2Tasks).toHaveLength(0);
  });

  it("keeps recent activity ordered from oldest to newest within the latest window", async () => {
    const project = await createProject(db, { name: "activity-project" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/activity-project",
    });

    for (let i = 0; i < 12; i++) {
      await logActivity(db, {
        projectId: project.id,
        workspaceId: ws.id,
        eventType: "note",
        payload: { message: `Note ${i}` },
      });
    }

    // Verify that only the last 10 entries are returned and in order
    const activity = await listActivity(db, {
      projectId: project.id,
      workspaceId: ws.id,
      limit: 10,
    });
    expect(activity).toHaveLength(10);
    // Notes 2–11 should be present, Note 0 and 1 should not
    const messages = activity.map((a) => (JSON.parse(a.payload) as { message: string }).message);
    expect(messages).not.toContain("Note 0");
    expect(messages).not.toContain("Note 1");
    expect(messages).toContain("Note 2");
    expect(messages).toContain("Note 11");
    expect(messages.indexOf("Note 2")).toBeLessThan(messages.indexOf("Note 11"));
  });

  it("rejects a second active PRD in the same workspace", async () => {
    const project = await createProject(db, { name: "single-active-prd" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/single-active-prd",
    });

    const prd1 = await createPrd(db, {
      projectId: project.id,
      title: "First PRD",
    });
    const prd2 = await createPrd(db, {
      projectId: project.id,
      title: "Second PRD",
    });

    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd1.id));
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd2.id));
    await activatePrd(db, prd1.id, ws.id);

    await expect(activatePrd(db, prd2.id, ws.id)).rejects.toThrow(
      /workspace already has active prd/i,
    );
  });
});
