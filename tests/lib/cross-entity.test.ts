import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import {
  assertWorkspaceInProject,
  assertPrdInProject,
  assertPrdInWorkspace,
  assertTaskInPrd,
} from "#/lib/cross-entity";
import { createProject } from "#/modules/projects/domain";
import { addWorkspace } from "#/modules/workspaces/domain";
import { createPrd, activatePrd } from "#/modules/prds/domain";
import { createTask } from "#/modules/tasks/domain";
import type { Database } from "#/db/client";

describe("cross-entity helpers", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectA: string;
  let projectB: string;
  let workspaceA: string;
  let workspaceB: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const a = await run(createProject({ name: "A" }));
    const b = await run(createProject({ name: "B" }));
    projectA = a.id;
    projectB = b.id;
    workspaceA = (await run(addWorkspace({ projectId: projectA, path: "/tmp/a" }))).id;
    workspaceB = (await run(addWorkspace({ projectId: projectB, path: "/tmp/b" }))).id;
  });

  it("assertWorkspaceInProject passes on a matching pair", async () => {
    const ws = await run(assertWorkspaceInProject(workspaceA, projectA));
    expect(ws.id).toBe(workspaceA);
  });

  it("assertWorkspaceInProject fails on cross-project workspaceId", async () => {
    await expect(run(assertWorkspaceInProject(workspaceB, projectA))).rejects.toThrow(
      /belongs to project/,
    );
  });

  it("assertPrdInProject fails when the PRD belongs elsewhere", async () => {
    const prd = await run(createPrd({ projectId: projectA, title: "X" }));
    await expect(run(assertPrdInProject(prd.id, projectB))).rejects.toThrow(
      /does not belong to project/,
    );
  });

  it("activatePrd refuses a workspace from a different project", async () => {
    const prd = await run(createPrd({ projectId: projectA, title: "X" }));
    // Mark ready so activate is allowed by the lifecycle.
    const { markPrdReady } = await import("#/modules/prds/domain");
    await run(markPrdReady(prd.id));
    await expect(run(activatePrd(prd.id, workspaceB))).rejects.toThrow(/belongs to project/);
  });

  it("assertTaskInPrd succeeds for its own task", async () => {
    const prd = await run(createPrd({ projectId: projectA, title: "X" }));
    const task = await run(
      createTask({
        prdRevisionId: prd.id,
        title: "t",
        description: "d",
        doneCriteria: "ok",
        effort: "s",
      }),
    );
    const t = await run(assertTaskInPrd(task.id, prd.id));
    expect(t.id).toBe(task.id);
  });

  it("assertPrdInWorkspace fails when the PRD is bound to a different workspace", async () => {
    const prd = await run(createPrd({ projectId: projectA, title: "X" }));
    const { markPrdReady } = await import("#/modules/prds/domain");
    await run(markPrdReady(prd.id));
    await run(activatePrd(prd.id, workspaceA));
    await expect(run(assertPrdInWorkspace(prd.id, workspaceB))).rejects.toThrow(
      /does not belong to workspace/,
    );
  });

  it("CrossEntityError message includes PRD title and both workspace paths/labels", async () => {
    // Regression for the PRD 2.6 follow-up: opaque IDs in error messages
    // (PRD '01K…' does not belong to workspace '01K…') were illegible for
    // agents. Now the message includes labels, paths, and the PRD title.
    const prd = await run(
      createPrd({
        projectId: projectA,
        title: "Consultation des factures par admin",
      }),
    );
    const { markPrdReady } = await import("#/modules/prds/domain");
    await run(markPrdReady(prd.id));
    await run(activatePrd(prd.id, workspaceA));

    // workspaceA is at /tmp/a (no label), workspaceB is at /tmp/b (no label).
    await expect(run(assertPrdInWorkspace(prd.id, workspaceB))).rejects.toThrow(
      /Consultation des factures par admin/,
    );
    await expect(run(assertPrdInWorkspace(prd.id, workspaceB))).rejects.toThrow(/\/tmp\/a/);
    await expect(run(assertPrdInWorkspace(prd.id, workspaceB))).rejects.toThrow(/\/tmp\/b/);
    await expect(run(assertPrdInWorkspace(prd.id, workspaceB))).rejects.toThrow(
      /Either cd to that workspace/,
    );
  });

  it("CrossEntityError message includes project name when PRD belongs to a different project", async () => {
    const prd = await run(createPrd({ projectId: projectA, title: "X" }));
    await expect(run(assertPrdInProject(prd.id, projectB))).rejects.toThrow(/'B'/);
  });

  it("CrossEntityError message includes both project names when workspace belongs to wrong project", async () => {
    await expect(run(assertWorkspaceInProject(workspaceB, projectA))).rejects.toThrow(/'B'/);
    await expect(run(assertWorkspaceInProject(workspaceB, projectA))).rejects.toThrow(/'A'/);
    await expect(run(assertWorkspaceInProject(workspaceB, projectA))).rejects.toThrow(/\/tmp\/b/);
  });
});
