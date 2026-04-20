import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import {
  createProject,
  addWorkspace,
  resolveWorkspace,
  createPrd,
  commitPrd,
  activatePrd,
  amendPrd,
  createTask,
  startTask,
  completeTask,
  blockTask,
  skipTask,
  logActivity,
  listTasks,
  getPrd,
} from "#/lib/workflow";
import { buildHandoff } from "#/lib/handoff";

/**
 * End-to-end integration test: simulates a complete agent workflow
 * from project init through PRD creation, task execution, and handoff.
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
      workspaceId: ws.id,
      title: "Core Foundation",
      context: "Build the initial CLI foundation",
      scope: "DB, workflow, handoff",
    });
    expect(prd.status).toBe("draft");

    // 5. Agent commits the PRD
    const committed = await commitPrd(db, prd.id);
    expect(committed.status).toBe("committed");

    // 6. Agent activates the PRD
    const activated = await activatePrd(db, prd.id);
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
      title: "Build handoff command",
      description: "Structured plaintext output for agent recovery",
      doneCriteria: "Handoff output matches spec format",
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

    // 11. Generate handoff mid-session
    const handoff1 = await buildHandoff(db, ws.id);
    expect(handoff1).toContain("=== DEPOT HANDOFF");
    expect(handoff1).toContain("depot");
    expect(handoff1).toContain("Core Foundation");
    expect(handoff1).toContain("1/3 done");
    expect(handoff1).toContain("Implement workflow engine"); // current task
    expect(handoff1).toContain("## Current Task");

    // 12. Complete task 2
    await completeTask(db, t2.id);

    // 13. Start and complete task 3
    await startTask(db, t3.id);
    await completeTask(db, t3.id);

    // 14. All tasks done
    const finalTasks = await listTasks(db, prd.id);
    expect(finalTasks.every((t) => t.status === "done")).toBe(true);

    // 15. Final handoff
    const handoff2 = await buildHandoff(db, ws.id);
    expect(handoff2).toContain("3/3 done");
  });

  it("handles PRD amend and revision flow", async () => {
    const project = await createProject(db, { name: "my-project" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/my-project",
    });

    // Create and commit a PRD
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Feature X v1",
      context: "Original plan",
    });
    await commitPrd(db, prd.id);

    // Amend creates a new revision
    const v2 = await amendPrd(db, prd.id, {
      title: "Feature X v2",
      context: "Updated plan with new requirements",
    });
    expect(v2.revision).toBe(2);
    expect(v2.parentId).toBe(prd.id);
    expect(v2.status).toBe("draft");

    // Original is archived
    const original = await getPrd(db, prd.id);
    expect(original!.status).toBe("archived");

    // Can commit and activate the new revision
    await commitPrd(db, v2.id);
    const activated = await activatePrd(db, v2.id);
    expect(activated.status).toBe("in_progress");
  });

  it("handles task blocking and unblocking flow", async () => {
    const project = await createProject(db, { name: "my-project" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/my-project",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Feature Y",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

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

    // Handoff should show the skipped task properly
    const handoff = await buildHandoff(db, ws.id);
    expect(handoff).toContain("DEPOT HANDOFF");
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
      workspaceId: ws1.id,
      title: "Backend refactor",
    });
    const prd2 = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws2.id,
      title: "New feature",
    });

    await commitPrd(db, prd1.id);
    await activatePrd(db, prd1.id);
    await commitPrd(db, prd2.id);
    await activatePrd(db, prd2.id);

    // Handoff for ws1 shows prd1
    const h1 = await buildHandoff(db, ws1.id);
    expect(h1).toContain("Backend refactor");
    expect(h1).not.toContain("New feature");

    // Handoff for ws2 shows prd2
    const h2 = await buildHandoff(db, ws2.id);
    expect(h2).toContain("New feature");
    expect(h2).not.toContain("Backend refactor");
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

    const handoff = await buildHandoff(db, ws.id);
    expect(handoff).toContain("Note 2");
    expect(handoff).toContain("Note 11");
    expect(handoff).not.toMatch(/\bNote 1\b/);
    expect(handoff.indexOf("Note 2")).toBeLessThan(handoff.indexOf("Note 11"));
  });

  it("rejects a second active PRD in the same workspace", async () => {
    const project = await createProject(db, { name: "single-active-prd" });
    const ws = await addWorkspace(db, {
      projectId: project.id,
      path: "/home/agent/single-active-prd",
    });

    const prd1 = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "First PRD",
    });
    const prd2 = await createPrd(db, {
      projectId: project.id,
      workspaceId: ws.id,
      title: "Second PRD",
    });

    await commitPrd(db, prd1.id);
    await commitPrd(db, prd2.id);
    await activatePrd(db, prd1.id);

    await expect(activatePrd(db, prd2.id)).rejects.toThrow(/workspace already has active prd/i);
  });
});
