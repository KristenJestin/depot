import { describe, it, expect, beforeEach } from "vitest";
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
});
