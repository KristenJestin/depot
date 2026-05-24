import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { addRepo } from "#/modules/projects/repos";
import { createPrd, forkPrd, markPrdReady } from "#/modules/prds/domain";
import { addPrdRepo, listPrdRepos, removePrdRepo, resolvePrdRepos } from "#/modules/prds/repos";
import { createTask, updateTask } from "#/modules/tasks/domain";
import type { Database } from "#/db/client";

describe("prd_repo association", () => {
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

  it("adds a repo to a PRD and lists it", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repo = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));

    const link = await run(addPrdRepo(prd.id, repo.id));
    expect(link.prdRevisionId).toBe(prd.id);
    expect(link.repoId).toBe(repo.id);

    const list = await run(listPrdRepos(prd.id));
    expect(list).toHaveLength(1);
    expect(list[0]?.repoId).toBe(repo.id);
  });

  it("is idempotent: adding the same repo twice returns the existing row", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repo = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));

    const first = await run(addPrdRepo(prd.id, repo.id));
    const second = await run(addPrdRepo(prd.id, repo.id));
    expect(second.id).toBe(first.id);

    const list = await run(listPrdRepos(prd.id));
    expect(list).toHaveLength(1);
  });

  it("rejects a repo that belongs to another project", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const foreignRepo = await run(
      addRepo({ projectId: otherProjectId, name: "api", path: "/tmp/api" }),
    );
    await expect(run(addPrdRepo(prd.id, foreignRepo.id))).rejects.toThrow(
      /does not belong to project/,
    );
  });

  it("removes a repo from a PRD", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repo = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    await run(addPrdRepo(prd.id, repo.id));
    await run(removePrdRepo(prd.id, repo.id));
    expect(await run(listPrdRepos(prd.id))).toHaveLength(0);
  });

  it("removing a repo not associated with the PRD is a no-op", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repo = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    await expect(run(removePrdRepo(prd.id, repo.id))).resolves.toBeUndefined();
  });

  it("fork copies the parent revision's prd_repo entries", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repoA = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    const repoB = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
    await run(addPrdRepo(prd.id, repoA.id));
    await run(addPrdRepo(prd.id, repoB.id));
    await run(markPrdReady(prd.id));

    const forked = await run(forkPrd(prd.id));
    const repos = await run(listPrdRepos(forked.id));
    expect(repos.map((r) => r.repoId).sort()).toEqual([repoA.id, repoB.id].sort());

    // Confirm the parent revision keeps its rows too (independent copies).
    const parentRepos = await run(listPrdRepos(prd.id));
    expect(parentRepos.map((r) => r.repoId).sort()).toEqual([repoA.id, repoB.id].sort());
  });
});

describe("task.repoId validation", () => {
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

  it("creates a task with no repo when prd_repo is empty (mono-repo)", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const task = await run(
      createTask({
        prdRevisionId: prd.id,
        title: "t",
        description: "d",
        doneCriteria: "ok",
        effort: "s",
      }),
    );
    expect(task.repoId).toBeNull();
  });

  it("creates a task with a repoId that belongs to the PRD scope", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repo = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    await run(addPrdRepo(prd.id, repo.id));

    const task = await run(
      createTask({
        prdRevisionId: prd.id,
        title: "t",
        description: "d",
        doneCriteria: "ok",
        effort: "s",
        repoId: repo.id,
      }),
    );
    expect(task.repoId).toBe(repo.id);
  });

  it("rejects a task whose repoId is not in the PRD's prd_repo", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repoIn = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    const repoOut = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
    await run(addPrdRepo(prd.id, repoIn.id));

    await expect(
      run(
        createTask({
          prdRevisionId: prd.id,
          title: "t",
          description: "d",
          doneCriteria: "ok",
          effort: "s",
          repoId: repoOut.id,
        }),
      ),
    ).rejects.toThrow(/not in the PRD's repo scope/);
  });

  it("rejects a task whose repoId belongs to another project", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const foreign = await run(
      addRepo({ projectId: otherProjectId, name: "api", path: "/tmp/api" }),
    );
    await expect(
      run(
        createTask({
          prdRevisionId: prd.id,
          title: "t",
          description: "d",
          doneCriteria: "ok",
          effort: "s",
          repoId: foreign.id,
        }),
      ),
    ).rejects.toThrow(/not in the PRD's repo scope/);
  });

  it("update can set, change, and clear task.repoId", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repoA = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    const repoB = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
    await run(addPrdRepo(prd.id, repoA.id));
    await run(addPrdRepo(prd.id, repoB.id));

    const task = await run(
      createTask({
        prdRevisionId: prd.id,
        title: "t",
        description: "d",
        doneCriteria: "ok",
        effort: "s",
        repoId: repoA.id,
      }),
    );
    const updated = await run(updateTask(task.id, { repoId: repoB.id }));
    expect(updated.repoId).toBe(repoB.id);

    const cleared = await run(updateTask(task.id, { repoId: null }));
    expect(cleared.repoId).toBeNull();
  });

  it("update rejects a repoId not in the PRD scope", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const repoIn = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    const repoOut = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
    await run(addPrdRepo(prd.id, repoIn.id));

    const task = await run(
      createTask({
        prdRevisionId: prd.id,
        title: "t",
        description: "d",
        doneCriteria: "ok",
        effort: "s",
      }),
    );
    await expect(run(updateTask(task.id, { repoId: repoOut.id }))).rejects.toThrow(
      /not in the PRD's repo scope/,
    );
  });
});

describe("resolvePrdRepos (PRD 0007 T3)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "main" }))).id;
  });

  it("returns the PRD's prd_repo entries when non-empty", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const api = await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    const front = await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
    await run(addRepo({ projectId, name: "docs", path: "/tmp/docs" }));
    await run(addPrdRepo(prd.id, api.id));
    await run(addPrdRepo(prd.id, front.id));

    const resolved = await run(resolvePrdRepos(prd.id, projectId, "/tmp"));
    expect(resolved.map((r) => r.name).sort()).toEqual(["api", "front"]);
    for (const r of resolved) {
      expect(r.implicit).toBe(false);
      expect(r.id).not.toBeNull();
    }
  });

  it("falls back to all project_repo when prd_repo is empty", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));

    const resolved = await run(resolvePrdRepos(prd.id, projectId, "/tmp"));
    expect(resolved.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("falls back to the implicit repo when project has no project_repo (mono-repo)", async () => {
    const prd = await run(createPrd({ projectId, title: "X" }));
    const resolved = await run(resolvePrdRepos(prd.id, projectId, "/tmp/wspace"));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.implicit).toBe(true);
    expect(resolved[0]?.id).toBeNull();
  });
});
