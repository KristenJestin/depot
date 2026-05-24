import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTestDb, makeRun } from "../helpers/db";
import {
  createDirective,
  listDirectives,
  updateDirective,
  removeDirective,
  runDirective,
  runScopeBlocking,
  runScopeBlockingForPrd,
  reorderDirectives,
} from "#/modules/projects/directives";
import { createProject } from "#/modules/projects/domain";
import { addRepo } from "#/modules/projects/repos";
import { listActivity } from "#/modules/activity/domain";
import { formatSelectionTrace } from "#/modules/projects/directives";
import { createPrd } from "#/modules/prds/domain";
import { addPrdRepo } from "#/modules/prds/repos";
import type { Database } from "#/db/client";

describe("project directives", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  it("creates and lists directives by scope", async () => {
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Format",
        instruction: "echo format",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        kind: "rule",
        title: "Update CHANGELOG",
        instruction: "always update CHANGELOG before ship",
      }),
    );
    const preReview = await run(listDirectives(projectId, { scope: "pre-review" }));
    expect(preReview).toHaveLength(1);
    expect(preReview[0]?.title).toBe("Format");
    const preShip = await run(listDirectives(projectId, { scope: "pre-ship" }));
    expect(preShip).toHaveLength(1);
    expect(preShip[0]?.kind).toBe("rule");
  });

  it("refuses dangerous shell patterns", async () => {
    await expect(
      run(
        createDirective({
          projectId,
          scope: "pre-review",
          kind: "command",
          title: "Bad",
          instruction: "rm -rf /tmp/foo",
        }),
      ),
    ).rejects.toThrow(/dangerous pattern/);
  });

  it("updates a directive", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Lint",
        instruction: "echo lint",
      }),
    );
    const updated = await run(updateDirective(d.id, { enabled: false, title: "Lint (disabled)" }));
    expect(updated.enabled).toBe(false);
    expect(updated.title).toBe("Lint (disabled)");
  });

  it("removes a directive", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Tmp",
        instruction: "echo tmp",
      }),
    );
    await run(removeDirective(d.id));
    const remaining = await run(listDirectives(projectId));
    expect(remaining).toHaveLength(0);
  });

  it("runs a command directive and records last run status", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo success",
        instruction: "echo hello",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: process.cwd() }));
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("hello");
    const after = (await run(listDirectives(projectId)))[0]!;
    expect(after.lastRunStatus).toBe("ok");
  });

  it("captures failure exit codes", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Fails",
        instruction: "exit 7",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: process.cwd() }));
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
  });

  it("runScopeBlocking stops at first failure", async () => {
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "A - ok",
        instruction: "echo a",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "B - fails",
        instruction: "exit 3",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "C - never runs",
        instruction: "echo c",
      }),
    );
    const result = await run(runScopeBlocking(projectId, "pre-review", { wsPath: process.cwd() }));
    expect(result.ok).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]?.ok).toBe(false);
    expect(result.failingDirectiveId).toBeTruthy();
  });

  it("defaults repoTarget to auto", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Format",
        instruction: "echo format",
      }),
    );
    expect(d.repoTarget).toBe("auto");
    const explicit = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "API only",
        instruction: "echo api",
        repoTarget: "api",
      }),
    );
    expect(explicit.repoTarget).toBe("api");
  });

  it("reorders directives by position", async () => {
    const a = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "A",
        instruction: "echo a",
      }),
    );
    const b = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "B",
        instruction: "echo b",
      }),
    );
    await run(reorderDirectives(projectId, "pre-review", [b.id, a.id]));
    const list = await run(listDirectives(projectId, { scope: "pre-review" }));
    expect(list.map((d) => d.title)).toEqual(["B", "A"]);
  });
});

describe("formatSelectionTrace", () => {
  it("returns null for the single-repo / mono-repo case (no extra noise)", () => {
    expect(
      formatSelectionTrace({ reason: "single-repo", repos: [{ name: "(default)", path: "/x" }] }),
    ).toBeNull();
  });

  it("lists the dirty repos and the considered-vs-matched ratio for auto-dirty", () => {
    const trace = formatSelectionTrace({
      reason: "auto-dirty",
      repos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
      ],
      consideredRepos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
        { name: "docs", path: "/d" },
      ],
    });
    expect(trace).toContain("api");
    expect(trace).toContain("front");
    expect(trace).toContain("2/3");
    expect(trace).toContain("uncommitted");
  });

  it("explains auto-no-dirty as the empty selection it is", () => {
    const trace = formatSelectionTrace({
      reason: "auto-no-dirty",
      repos: [],
      consideredRepos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
      ],
    });
    expect(trace).toContain("none");
    expect(trace).toContain("0/2");
  });

  it("labels explicit `all` selections", () => {
    const trace = formatSelectionTrace({
      reason: "all",
      repos: [
        { name: "api", path: "/a" },
        { name: "front", path: "/f" },
      ],
    });
    expect(trace).toContain("api, front");
    expect(trace).toContain("all");
  });
});

describe("repo-aware directives", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  const tempDirs: string[] = [];

  async function makeGitRepo(dirty: boolean): Promise<string> {
    const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-dir-repo-")));
    tempDirs.push(root);
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: root });
    execFileSync("git", ["config", "user.name", "t"], { cwd: root });
    await fs.writeFile(path.join(root, "f.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
    if (dirty) await fs.writeFile(path.join(root, "f.txt"), "changed");
    return root;
  }

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("repoTarget: auto runs only in modified repos", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo cwd",
        instruction: "echo cwd",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.repoResults).toHaveLength(1);
    expect(result.repoResults[0]?.repoName).toBe("api");
  });

  it("repoTarget: auto is a no-op when no repo is modified", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Should fail if run",
        instruction: "exit 1",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.noOp).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.repoResults).toHaveLength(0);
  });

  it("repoTarget: all runs in every registered repo", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "all",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.repoResults.map((r) => r.repoName).sort()).toEqual(["api", "front"]);
  });

  it("repoTarget: <name> runs only in the named repo", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "front",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.repoResults).toHaveLength(1);
    expect(result.repoResults[0]?.repoName).toBe("front");
  });

  it("mono-repo project runs auto in the implicit repo", async () => {
    const repo = await makeGitRepo(false);
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: repo }));
    expect(result.ok).toBe(true);
    expect(result.repoResults).toHaveLength(1);
    expect(result.noOp).toBe(false);
  });

  it("repoTarget: auto exposes selection (repos + reason) for N dirty repos", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(true);
    const docsRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    await run(addRepo({ projectId, name: "docs", path: docsRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.selection.reason).toBe("auto-dirty");
    expect(result.selection.repos.map((r) => r.name).sort()).toEqual(["api", "front"]);
    expect(result.selection.consideredRepos?.map((r) => r.name).sort()).toEqual([
      "api",
      "docs",
      "front",
    ]);
  });

  it("repoTarget: auto with single dirty repo (multi-repo project) still traces selection", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.selection.reason).toBe("auto-dirty");
    expect(result.selection.repos.map((r) => r.name)).toEqual(["api"]);
    expect(result.selection.consideredRepos?.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("mono-repo project: selection reason is `single-repo` (minimal trace)", async () => {
    const repo = await makeGitRepo(true);
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: repo }));
    expect(result.selection.reason).toBe("single-repo");
    expect(result.selection.repos).toHaveLength(1);
    expect(result.selection.consideredRepos).toBeUndefined();
  });

  it("repoTarget: auto with no dirty repo exposes empty selection + reason", async () => {
    const apiRepo = await makeGitRepo(false);
    const frontRepo = await makeGitRepo(false);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    const result = await run(runDirective(d.id, { wsPath: apiRepo }));
    expect(result.selection.reason).toBe("auto-no-dirty");
    expect(result.selection.repos).toEqual([]);
    expect(result.selection.consideredRepos?.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("records a directive_run activity entry with the selection payload", async () => {
    const apiRepo = await makeGitRepo(true);
    const frontRepo = await makeGitRepo(true);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    await run(runDirective(d.id, { wsPath: apiRepo }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    const payload = JSON.parse(runEntry!.payload) as {
      directiveId: string;
      status: string;
      repoTarget: string;
      selection: { reason: string; repos: Array<{ name: string }> };
    };
    expect(payload.directiveId).toBe(d.id);
    expect(payload.status).toBe("ok");
    expect(payload.repoTarget).toBe("auto");
    expect(payload.selection.reason).toBe("auto-dirty");
    expect(payload.selection.repos.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("mono-repo: directive_run log carries the minimal selection (single-repo)", async () => {
    const repo = await makeGitRepo(false);
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "auto",
      }),
    );
    await run(runDirective(d.id, { wsPath: repo }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    const payload = JSON.parse(runEntry!.payload) as {
      selection: { reason: string; repos: unknown[] };
    };
    expect(payload.selection.reason).toBe("single-repo");
    expect(payload.selection.repos).toHaveLength(1);
  });
});

describe("runDirective — PRD-scoped activity log (PRD 0007 T2)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  const multiRepoTempDirs: string[] = [];

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "test" }))).id;
  });

  afterEach(async () => {
    for (const dir of multiRepoTempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("attaches prd_revision_id to the directive_run log line when prdRevisionId is passed", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
      }),
    );
    await run(runDirective(d.id, { wsPath: process.cwd(), prdRevisionId: prd.id }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    expect(runEntry!.prdRevisionId).toBe(prd.id);
  });

  it("leaves prd_revision_id null when prdRevisionId is omitted", async () => {
    const d = await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
      }),
    );
    await run(runDirective(d.id, { wsPath: process.cwd() }));
    const entries = await run(listActivity({ projectId }));
    const runEntry = entries.find((e) => e.eventType === "directive_run");
    expect(runEntry).toBeTruthy();
    expect(runEntry!.prdRevisionId).toBeNull();
  });

  it("runScopeBlockingForPrd iterates the PRD's prd_repo with workspace target", async () => {
    const apiRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    const frontRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    multiRepoTempDirs.push(apiRepo, frontRepo);
    const api = await run(addRepo({ projectId, name: "api", path: apiRepo }));
    const front = await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(addPrdRepo(prd.id, api.id));
    await run(addPrdRepo(prd.id, front.id));
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        kind: "command",
        title: "Print cwd",
        instruction: "echo cwd",
        repoTarget: "workspace",
      }),
    );
    const result = await run(runScopeBlockingForPrd(prd.id, "pre-ship", { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.perRepo.map((r) => r.repoName).sort()).toEqual(["api", "front"]);
    // Both repo iterations succeeded.
    for (const repoOutcome of result.perRepo) {
      expect(repoOutcome.ok).toBe(true);
      expect(repoOutcome.results).toHaveLength(1);
    }
    // Each iteration produced a directive_run log line attributed to the PRD.
    const entries = await run(listActivity({ projectId }));
    const runEntries = entries.filter((e) => e.eventType === "directive_run");
    expect(runEntries).toHaveLength(2);
    for (const entry of runEntries) {
      expect(entry.prdRevisionId).toBe(prd.id);
    }
  });

  it("runScopeBlockingForPrd falls back to project_repo when prd_repo is empty", async () => {
    const apiRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    const frontRepo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    multiRepoTempDirs.push(apiRepo, frontRepo);
    await run(addRepo({ projectId, name: "api", path: apiRepo }));
    await run(addRepo({ projectId, name: "front", path: frontRepo }));
    const prd = await run(createPrd({ projectId, title: "feature" }));
    // Intentionally no `prd_repo` rows — fallback should iterate all project_repos.
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "workspace",
      }),
    );
    const result = await run(runScopeBlockingForPrd(prd.id, "pre-ship", { wsPath: apiRepo }));
    expect(result.ok).toBe(true);
    expect(result.perRepo.map((r) => r.repoName).sort()).toEqual(["api", "front"]);
  });

  it("runScopeBlockingForPrd in mono-repo runs once against the implicit repo", async () => {
    const repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "depot-pr-")));
    multiRepoTempDirs.push(repo);
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(
      createDirective({
        projectId,
        scope: "pre-ship",
        kind: "command",
        title: "Echo",
        instruction: "echo hi",
        repoTarget: "workspace",
      }),
    );
    const result = await run(runScopeBlockingForPrd(prd.id, "pre-ship", { wsPath: repo }));
    expect(result.ok).toBe(true);
    expect(result.perRepo).toHaveLength(1);
    expect(result.perRepo[0]?.results).toHaveLength(1);
  });

  it("runScopeBlocking propagates prdRevisionId to each directive_run log line", async () => {
    const prd = await run(createPrd({ projectId, title: "feature" }));
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "A",
        instruction: "echo a",
      }),
    );
    await run(
      createDirective({
        projectId,
        scope: "pre-review",
        kind: "command",
        title: "B",
        instruction: "echo b",
      }),
    );
    await run(
      runScopeBlocking(projectId, "pre-review", {
        wsPath: process.cwd(),
        prdRevisionId: prd.id,
      }),
    );
    const entries = await run(listActivity({ projectId }));
    const runEntries = entries.filter((e) => e.eventType === "directive_run");
    expect(runEntries).toHaveLength(2);
    for (const entry of runEntries) {
      expect(entry.prdRevisionId).toBe(prd.id);
    }
  });
});
