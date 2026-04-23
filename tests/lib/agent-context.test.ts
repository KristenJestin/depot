import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { prds } from "#/db/schema";
import { formatStructuredTaskDescription } from "#/modules/tasks/spec";
import {
  activatePrd,
  addWorkspace,
  completeTask,
  createPrd,
  createProject,
  createTask,
  logActivity,
  startTask,
} from "#/lib/workflow";
import {
  checkPrdLaunchability,
  renderContextIndex,
  renderContextMode,
  resolvePrdTarget,
} from "#/modules/context/render";
import { formatPathForDisplay } from "#/shared/utils";

let db: Database;

beforeEach(() => {
  ({ db } = createTestDb());
});

describe("agent context renderer", () => {
  it("renders the context index with prd and dev sections in order", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });

    const output = await renderContextIndex(db, workspace.id);

    expect(output).toContain("=== DEPOT CONTEXT");
    expect(output.indexOf("## prd")).toBeLessThan(output.indexOf("## dev"));
    expect(output).toContain("Detail : depot context prd");
    expect(output).toContain("Detail : depot context dev");
    expect(output).not.toContain("Detail : depot context review");
  });

  it("renders prd context with full IDs and actionable intro", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });
    const older = await createPrd(db, {
      projectId: project.id,
      title: "Older PRD",
    });
    const newer = await createPrd(db, {
      projectId: project.id,
      title: "Newer PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, newer.id));

    const output = await renderContextMode(db, workspace.id, "prd");

    expect(output).toContain(`depot prd show ${newer.id}`);
    expect(output).toContain(`${newer.id}  Newer PRD  [ready]  rev 1`);
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
    const current = await createPrd(db, {
      projectId: project.id,
      title: "Current plan",
      context: "Current execution context",
      scope: "Context command and install flow",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, current.id));
    await activatePrd(db, current.id, workspace.id);

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

  it("fails dev mode when multiple active PRDs exist", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, {
      projectId: project.id,
      path: "/workspace/depot",
    });
    const first = await createPrd(db, {
      projectId: project.id,
      title: "First active",
    });
    const second = await createPrd(db, {
      projectId: project.id,
      title: "Second active",
    });
    await db
      .update(prds)
      .set({ status: "in_progress", workspaceId: workspace.id })
      .where(eq(prds.id, first.id));
    await db
      .update(prds)
      .set({ status: "in_progress", workspaceId: workspace.id })
      .where(eq(prds.id, second.id));

    await expect(renderContextMode(db, workspace.id, "dev")).rejects.toThrow(
      /Multiple active PRDs found/,
    );
  });

  it("formats workspace paths with a home prefix when possible", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = "/home/tester";

    expect(formatPathForDisplay("/home/tester/projects/depot")).toBe("~/projects/depot");

    process.env.HOME = originalHome;
  });
});

describe("resolvePrdTarget", () => {
  it("resolves by exact ID", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "My feature PRD",
    });

    const result = await resolvePrdTarget(db, workspace.id, prd.id);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("unreachable");
    expect(result.prd.id).toBe(prd.id);
  });

  it("resolves by unique title substring (case-insensitive)", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Explicit PRD Targeting Feature",
    });

    const result = await resolvePrdTarget(db, workspace.id, "explicit prd");
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("unreachable");
    expect(result.prd.id).toBe(prd.id);
  });

  it("returns ambiguous when title matches multiple PRDs", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    await createPrd(db, {
      projectId: project.id,
      title: "Auth feature alpha",
    });
    await createPrd(db, {
      projectId: project.id,
      title: "Auth feature beta",
    });

    const result = await resolvePrdTarget(db, workspace.id, "auth feature");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("unreachable");
    expect(result.candidates).toHaveLength(2);
  });

  it("returns not_found when no PRD matches", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });

    const result = await resolvePrdTarget(db, workspace.id, "nonexistent-prd-xyz");
    expect(result.kind).toBe("not_found");
  });

  it("resolves project PRDs from any workspace in the same project", async () => {
    const project = await createProject(db, { name: "depot" });
    const _ws1 = await addWorkspace(db, { projectId: project.id, path: "/ws1" });
    const ws2 = await addWorkspace(db, { projectId: project.id, path: "/ws2" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "ws1 PRD",
    });

    // PRD is project-scoped (workspaceId null) — resolvable from any workspace in the project
    const result = await resolvePrdTarget(db, ws2.id, prd.id);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("unreachable");
    expect(result.prd.id).toBe(prd.id);
  });
});

describe("checkPrdLaunchability", () => {
  it("allows a ready PRD with no active PRD in workspace", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "My PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    const readyPrd = (await db.query.prds.findFirst({ where: { id: prd.id } }))!;

    const result = await checkPrdLaunchability(db, workspace.id, readyPrd);
    expect(result.launchable).toBe(true);
  });

  it("allows an in_progress PRD", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "My PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    const activated = await activatePrd(db, prd.id, workspace.id);

    const result = await checkPrdLaunchability(db, workspace.id, activated);
    expect(result.launchable).toBe(true);
  });

  it("rejects a draft PRD", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Draft PRD",
    });

    const result = await checkPrdLaunchability(db, workspace.id, prd);
    expect(result.launchable).toBe(false);
    if (result.launchable) throw new Error("unreachable");
    expect(result.reason).toContain("draft");
  });

  it("rejects a canceled PRD", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Canceled PRD",
    });
    await db.update(prds).set({ status: "canceled" }).where(eq(prds.id, prd.id));

    const canceledPrd = (await db.query.prds.findFirst({ where: { id: prd.id } }))!;
    const result = await checkPrdLaunchability(db, workspace.id, canceledPrd);
    expect(result.launchable).toBe(false);
    if (result.launchable) throw new Error("unreachable");
    expect(result.reason).toContain("canceled");
  });

  it("rejects a ready PRD when another PRD is already active", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });

    const active = await createPrd(db, {
      projectId: project.id,
      title: "Active PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, active.id));
    await activatePrd(db, active.id, workspace.id);

    const candidate = await createPrd(db, {
      projectId: project.id,
      title: "Candidate PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, candidate.id));
    const readyCandidate = (await db.query.prds.findFirst({ where: { id: candidate.id } }))!;

    const result = await checkPrdLaunchability(db, workspace.id, readyCandidate);
    expect(result.launchable).toBe(false);
    if (result.launchable) throw new Error("unreachable");
    expect(result.reason).toContain(active.id);
  });
});

describe("renderContextMode dev with explicit prdTarget", () => {
  it("renders dev context for an explicitly targeted PRD by ID", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Targeted PRD",
      context: "explicit targeting context",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    await activatePrd(db, prd.id, workspace.id);

    const activePrd = (await db.query.prds.findFirst({ where: { id: prd.id } }))!;
    const output = await renderContextMode(db, workspace.id, "dev", activePrd.id);

    expect(output).toContain("Targeted PRD");
    expect(output).toContain("[in_progress]");
    expect(output).toContain("Context: Dev Agent");
  });

  it("renders dev context for a targeted PRD by unique title substring", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Unique Feature PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    await activatePrd(db, prd.id, workspace.id);

    const output = await renderContextMode(db, workspace.id, "dev", "unique feature");
    expect(output).toContain("Unique Feature PRD");
  });

  it("throws with a list of candidates on ambiguous target", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const alpha = await createPrd(db, {
      projectId: project.id,
      title: "Auth alpha",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, alpha.id));
    const beta = await createPrd(db, {
      projectId: project.id,
      title: "Auth beta",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, beta.id));

    await expect(renderContextMode(db, workspace.id, "dev", "auth")).rejects.toThrow(
      /matches multiple PRDs/,
    );
  });

  it("throws with no-match guidance when target is not found", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });

    await expect(renderContextMode(db, workspace.id, "dev", "totally-unknown-prd")).rejects.toThrow(
      /No PRD found matching/,
    );
  });

  it("throws with launchability reason when targeted PRD is in draft status", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Draft PRD target",
    });

    await expect(renderContextMode(db, workspace.id, "dev", prd.id)).rejects.toThrow(
      /cannot be launched in dev mode/,
    );
  });

  it("leaves default behavior unchanged when no prdTarget is given", async () => {
    const project = await createProject(db, { name: "depot" });
    const workspace = await addWorkspace(db, { projectId: project.id, path: "/ws" });
    const prd = await createPrd(db, {
      projectId: project.id,
      title: "Auto-resolved PRD",
    });
    await db.update(prds).set({ status: "ready" }).where(eq(prds.id, prd.id));
    await activatePrd(db, prd.id, workspace.id);

    const output = await renderContextMode(db, workspace.id, "dev");
    expect(output).toContain("Auto-resolved PRD");
    expect(output).toContain("[in_progress]");
  });
});
