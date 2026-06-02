import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd } from "#/modules/prds/domain";
import {
  addDependency,
  removeDependency,
  listDependencies,
  listDependents,
  buildDependencyGraph,
} from "#/modules/prds/dependencies";
import type { Database } from "#/db/client";

describe("prd dependencies (PRD 0019 / T2)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "main" }))).id;
    otherProjectId = (await run(createProject({ name: "other" }))).id;
  });

  it("addDependency happy path: one row, idempotent on repeat", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const b = await run(createPrd({ projectId, title: "B" }));

    const first = await run(addDependency(a.prdId, b.prdId));
    expect(first.prdId).toBe(a.prdId);
    expect(first.dependsOnPrdId).toBe(b.prdId);

    const second = await run(addDependency(a.prdId, b.prdId));
    expect(second.prdId).toBe(first.prdId);
    expect(second.dependsOnPrdId).toBe(first.dependsOnPrdId);

    const deps = await run(listDependencies(a.prdId));
    expect(deps).toHaveLength(1);
    expect(deps[0]?.id).toBe(b.prdId);
  });

  it("addDependency refuses two PRDs from different projects", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const foreign = await run(createPrd({ projectId: otherProjectId, title: "F" }));

    await expect(run(addDependency(a.prdId, foreign.prdId))).rejects.toThrow(/different projects/);

    // No row inserted.
    expect(await run(listDependencies(a.prdId))).toHaveLength(0);
  });

  it("addDependency refuses a cycle of length 2 (A → B → A)", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const b = await run(createPrd({ projectId, title: "B" }));

    await run(addDependency(a.prdId, b.prdId));

    await expect(run(addDependency(b.prdId, a.prdId))).rejects.toThrow(
      new RegExp(`would create cycle:.*${a.prdId}.*${b.prdId}.*${a.prdId}`),
    );

    // The rejected edge must not have been inserted.
    expect(await run(listDependencies(b.prdId))).toHaveLength(0);
  });

  it("addDependency refuses a cycle of length 3 (A → B → C → A)", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const b = await run(createPrd({ projectId, title: "B" }));
    const c = await run(createPrd({ projectId, title: "C" }));

    await run(addDependency(a.prdId, b.prdId));
    await run(addDependency(b.prdId, c.prdId));

    await expect(run(addDependency(c.prdId, a.prdId))).rejects.toThrow(/would create cycle:/);

    expect(await run(listDependencies(c.prdId))).toHaveLength(0);
  });

  it("addDependency refuses a cycle of length 4 (A → B → C → D → A)", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const b = await run(createPrd({ projectId, title: "B" }));
    const c = await run(createPrd({ projectId, title: "C" }));
    const d = await run(createPrd({ projectId, title: "D" }));

    await run(addDependency(a.prdId, b.prdId));
    await run(addDependency(b.prdId, c.prdId));
    await run(addDependency(c.prdId, d.prdId));

    await expect(run(addDependency(d.prdId, a.prdId))).rejects.toThrow(/would create cycle:/);

    expect(await run(listDependencies(d.prdId))).toHaveLength(0);
  });

  it("removeDependency is a no-op when the edge is absent", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const b = await run(createPrd({ projectId, title: "B" }));

    await expect(run(removeDependency(a.prdId, b.prdId))).resolves.toBeUndefined();
    expect(await run(listDependencies(a.prdId))).toHaveLength(0);
  });

  it("listDependencies / listDependents return the right rows", async () => {
    const a = await run(createPrd({ projectId, title: "A" }));
    const b = await run(createPrd({ projectId, title: "B" }));
    const c = await run(createPrd({ projectId, title: "C" }));

    await run(addDependency(a.prdId, b.prdId));
    await run(addDependency(c.prdId, b.prdId));

    const deps = await run(listDependencies(a.prdId));
    expect(deps.map((d) => d.id).sort()).toEqual([b.prdId].sort());

    const dependents = await run(listDependents(b.prdId));
    expect(dependents.map((d) => d.id).sort()).toEqual([a.prdId, c.prdId].sort());

    // Sanity check on graph builder for completeness.
    const graph = await run(buildDependencyGraph(projectId));
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([a.prdId, b.prdId, c.prdId].sort());
    expect(graph.edges.length).toBe(2);

    await run(removeDependency(a.prdId, b.prdId));
    expect(await run(listDependents(b.prdId))).toHaveLength(1);
  });
});
