import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prds } from "#/db/schema";
import { formatStructuredTaskDescription } from "#/lib/task-spec";
import {
  activatePrd,
  addWorkspace,
  commitPrd,
  completeTask,
  createPrd,
  createProject,
  createTask,
  logActivity,
  startTask,
} from "#/lib/workflow";
import { formatPathForDisplay, renderContextIndex, renderContextMode } from "#/lib/agent-context";

let db: Database;

beforeEach(() => {
  ({ db } = createTestDb());
});

describe("agent context renderer", () => {
  it("renders the context index with prd, dev, and review sections in order", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });

    const output = await renderContextIndex(db, workspace.id);

    expect(output).toContain("=== DEPOT CONTEXT");
    expect(output.indexOf("## prd")).toBeLessThan(output.indexOf("## dev"));
    expect(output.indexOf("## dev")).toBeLessThan(output.indexOf("## review"));
    expect(output).toContain("Detail : depot context prd");
    expect(output).toContain("Detail : depot context dev");
    expect(output).toContain("Detail : depot context review");
  });

  it("renders prd context with full IDs and actionable intro", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });
    const older = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Older PRD",
    });
    const newer = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Newer PRD",
    });
    await commitPrd(db, newer.id);

    const output = await renderContextMode(db, workspace.id, "prd");

    expect(output).toContain(`depot prd show ${newer.id}`);
    expect(output).toContain(`${newer.id}  Newer PRD  [committed]  rev 1`);
    expect(output).toContain(`${older.id}  Older PRD  [draft]  rev 1`);
    expect(output).toContain("## Instructions");
    expect(output).toContain("Context: PRD Agent");
  });

  it("renders dev context with placeholders, progress, activity, and next task", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });
    const original = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Original plan",
      context: "Initial approach",
    });
    await commitPrd(db, original.id);
    const current = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Current plan",
      context: "Current execution context",
      scope: "Context command and install flow",
    });
    await db.update(prds).set({ status: "archived" }).where(eq(prds.id, original.id));
    await commitPrd(db, current.id);
    await activatePrd(db, current.id);

    const doneTask = await createTask(db, {
      prdId: current.id,
      title: "Finished task",
      description: "desc",
      doneCriteria: "done",
      effort: "s",
    });
    const currentTask = await createTask(db, {
      prdId: current.id,
      title: "Current task",
      description: formatStructuredTaskDescription({
        intent: "Implement the current execution path.",
        scope: "Touch the active task summary rendering.",
        nonGoals: "Do not retrofit older tasks.",
      }),
      doneCriteria: "current criteria",
      effort: "m",
    });
    const nextTask = await createTask(db, {
      prdId: current.id,
      title: "Next task",
      description: formatStructuredTaskDescription({
        intent: "Implement the next execution path.",
        scope: "Touch the next recommended task summary rendering.",
        nonGoals: "Do not redesign the whole context output.",
      }),
      doneCriteria: "next criteria",
      effort: "l",
      dependsOn: [doneTask.id],
    });
    await startTask(db, doneTask.id);
    await completeTask(db, doneTask.id);
    await startTask(db, currentTask.id);

    for (let i = 0; i < 12; i++) {
      await logActivity(db, {
        projectId: project.id,
        workspaceId: workspace.id,
        eventType: "note",
        payload: { message: `Note ${i}` },
      });
    }

    const output = await renderContextMode(db, workspace.id, "dev");

    expect(output).toContain("## Standards");
    expect(output).toContain("Standards are not modeled in depot yet.");
    expect(output).toContain("## Feedback");
    expect(output).toContain("Feedback is not modeled in depot yet.");
    expect(output).toContain(current.id);
    expect(output).toContain("Current task");
    expect(output).toContain("Summary : Implement the current execution path.");
    expect(output).toContain(`Read full spec: depot task show ${currentTask.id}`);
    expect(output).toContain(`${nextTask.id}  Next task`);
    expect(output).toContain("Summary     : Implement the next execution path.");
    expect(output).toContain(`Read full spec: depot task show ${nextTask.id}`);
    expect(output).toContain("Last 10 entries for the current workspace:");
    expect(output).toContain("Note 11");
    expect(output).not.toMatch(/\bNote 1\b/);
    expect(output).toContain("Context: Dev Agent");
  });

  it("renders review context with done tasks only", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });
    const prd = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Reviewable PRD",
      context: "Full context",
      scope: "Full scope",
    });
    await commitPrd(db, prd.id);
    await activatePrd(db, prd.id);

    const doneTask = await createTask(db, {
      prdId: prd.id,
      title: "Done task",
      description: "desc",
      doneCriteria: "criterion a\ncriterion b",
      effort: "s",
    });
    await startTask(db, doneTask.id);
    await completeTask(db, doneTask.id);
    await createTask(db, {
      prdId: prd.id,
      title: "Pending task",
      description: "desc",
      doneCriteria: "pending",
      effort: "m",
    });

    const output = await renderContextMode(db, workspace.id, "review");

    expect(output).toContain(`Context : Full context`);
    expect(output).toContain(`Scope   : Full scope`);
    expect(output).toContain(doneTask.id);
    expect(output).toContain("criterion a");
    expect(output).not.toContain("Pending task");
    expect(output).toContain("Context: Review Agent");
  });

  it("fails dev and review modes when multiple active PRDs exist", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });
    const first = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "First active",
    });
    const second = await createPrd(db, {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Second active",
    });
    await db.update(prds).set({ status: "in_progress" }).where(eq(prds.id, first.id));
    await db.update(prds).set({ status: "in_progress" }).where(eq(prds.id, second.id));

    await expect(renderContextMode(db, workspace.id, "dev")).rejects.toThrow(/Multiple active PRDs found/);
    await expect(renderContextMode(db, workspace.id, "review")).rejects.toThrow(/Multiple active PRDs found/);
  });

  it("formats workspace paths with a home prefix when possible", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/home/tester";

    expect(formatPathForDisplay("/home/tester/projects/depot")).toBe("~/projects/depot");

    process.env.HOME = originalHome;
  });
});
