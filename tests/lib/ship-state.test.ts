import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { Effect } from "effect";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { addRepo } from "#/modules/projects/repos";
import { listWorktrees, resolveWorktreeForBranch } from "#/lib/git";
import {
  resolveRepoShipState,
  pickFeatureWorktree,
  evaluateShipReadiness,
} from "#/modules/context/ship-state";
import type { RepoShipState } from "#/modules/context/ship-state";
import type { WorktreeEntry } from "#/lib/git";
import type { Database } from "#/db/client";

const run = <A>(effect: Effect.Effect<A, never>): Promise<A> => Effect.runPromise(effect);

async function makeGitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "depot-ship-test-"));
  const realRoot = await fs.realpath(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: realRoot });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: realRoot });
  execFileSync("git", ["config", "user.name", "t"], { cwd: realRoot });
  await fs.writeFile(path.join(realRoot, "f.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd: realRoot });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: realRoot });
  return realRoot;
}

async function addWorktree(repoRoot: string, branch: string): Promise<string> {
  const wtParent = await fs.mkdtemp(path.join(tmpdir(), "depot-ship-wt-"));
  const realParent = await fs.realpath(wtParent);
  const wtPath = path.join(realParent, branch.replace(/\//g, "-"));
  execFileSync("git", ["worktree", "add", "-q", "-b", branch, wtPath], { cwd: repoRoot });
  return wtPath;
}

describe("git worktree helpers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("listWorktrees returns the main checkout plus linked worktrees with branches", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    const wt = await addWorktree(repo, "feat/x");
    tempDirs.push(path.dirname(wt));

    const entries = await run(listWorktrees(repo));
    expect(entries.length).toBe(2);
    expect(path.resolve(entries[0]!.path)).toBe(path.resolve(repo));
    expect(entries[0]!.branch).toBe("main");
    const linked = entries.find((e) => e.branch === "feat/x");
    expect(linked).toBeDefined();
    expect(path.resolve(linked!.path)).toBe(path.resolve(wt));
  });

  it("listWorktrees returns an empty array for a non-git path", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-ship-nogit-"));
    tempDirs.push(dir);
    const entries = await run(listWorktrees(dir));
    expect(entries).toEqual([]);
  });

  it("resolveWorktreeForBranch matches a linked worktree by branch name", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    const wt = await addWorktree(repo, "feat/y");
    tempDirs.push(path.dirname(wt));

    const matched = await run(resolveWorktreeForBranch(repo, "feat/y"));
    expect(matched).not.toBeNull();
    expect(path.resolve(matched!)).toBe(path.resolve(wt));
  });

  it("resolveWorktreeForBranch never returns the main checkout", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    const matched = await run(resolveWorktreeForBranch(repo, "main"));
    expect(matched).toBeNull();
  });

  it("resolveWorktreeForBranch returns null when no worktree matches", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    const matched = await run(resolveWorktreeForBranch(repo, "feat/missing"));
    expect(matched).toBeNull();
  });
});

describe("pickFeatureWorktree", () => {
  const main: WorktreeEntry = { path: "/repo", branch: "main" };

  it("returns null when there are no linked worktrees", () => {
    expect(pickFeatureWorktree([main], null)).toBeNull();
  });

  it("returns the only linked worktree when there is exactly one", () => {
    const linked: WorktreeEntry = { path: "/wt/feat", branch: "feat/x" };
    expect(pickFeatureWorktree([main, linked], null)).toEqual(linked);
  });

  it("prefers the worktree matching an explicit hint", () => {
    const a: WorktreeEntry = { path: "/wt/a", branch: "feat/a" };
    const b: WorktreeEntry = { path: "/wt/b", branch: "feat/b" };
    expect(pickFeatureWorktree([main, a, b], "/wt/b")).toEqual(b);
  });

  it("returns null when multiple worktrees exist and the hint matches none", () => {
    const a: WorktreeEntry = { path: "/wt/a", branch: "feat/a" };
    const b: WorktreeEntry = { path: "/wt/b", branch: "feat/b" };
    expect(pickFeatureWorktree([main, a, b], "/wt/other")).toBeNull();
  });
});

describe("resolveRepoShipState", () => {
  let db: Database;
  let runDb: ReturnType<typeof makeRun>;
  let projectId: string;
  const tempDirs: string[] = [];

  beforeEach(async () => {
    db = createTestDb().db;
    runDb = makeRun(db);
    const project = await runDb(createProject({ name: "ship-test" }));
    projectId = project.id;
  });

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a single implicit repo for a mono-repo project", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    const states = await runDb(resolveRepoShipState(projectId, repo, null));
    expect(states).toHaveLength(1);
    expect(states[0]!.implicit).toBe(true);
    expect(states[0]!.name).toBe("(default)");
    expect(states[0]!.baseBranch).toBe("main");
    expect(states[0]!.worktreePath).toBeNull();
    expect(states[0]!.dirty).toBe(false);
  });

  it("reports a dirty mono-repo working tree", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    await fs.writeFile(path.join(repo, "dirty.txt"), "uncommitted");
    const states = await runDb(resolveRepoShipState(projectId, repo, null));
    expect(states[0]!.dirty).toBe(true);
  });

  it("resolves per-repo state for a multi-repo project, each on its base branch", async () => {
    const front = await makeGitRepo();
    const api = await makeGitRepo();
    tempDirs.push(front, api);
    await runDb(addRepo({ projectId, name: "front", path: front, baseBranch: "main" }));
    await runDb(addRepo({ projectId, name: "api", path: api, baseBranch: "develop" }));

    const states = await runDb(resolveRepoShipState(projectId, front, null));
    expect(states.map((s) => s.name).sort()).toEqual(["api", "front"]);
    expect(states.every((s) => !s.implicit)).toBe(true);
    expect(states.find((s) => s.name === "api")!.baseBranch).toBe("develop");
    expect(states.find((s) => s.name === "front")!.baseBranch).toBe("main");
  });

  it("detects the feature worktree per repo and its dirty status", async () => {
    const front = await makeGitRepo();
    const api = await makeGitRepo();
    tempDirs.push(front, api);
    await runDb(addRepo({ projectId, name: "front", path: front }));
    await runDb(addRepo({ projectId, name: "api", path: api }));

    const frontWt = await addWorktree(front, "feat/multi");
    tempDirs.push(path.dirname(frontWt));
    await fs.writeFile(path.join(frontWt, "wip.txt"), "uncommitted in worktree");

    const states = await runDb(resolveRepoShipState(projectId, front, null));
    const frontState = states.find((s) => s.name === "front")!;
    const apiState = states.find((s) => s.name === "api")!;

    expect(path.resolve(frontState.worktreePath!)).toBe(path.resolve(frontWt));
    expect(frontState.worktreeBranch).toBe("feat/multi");
    expect(frontState.dirty).toBe(true);

    expect(apiState.worktreePath).toBeNull();
    expect(apiState.dirty).toBe(false);
  });

  it("honours an explicit worktree hint when a repo has several worktrees", async () => {
    const repo = await makeGitRepo();
    tempDirs.push(repo);
    await runDb(addRepo({ projectId, name: "front", path: repo }));
    const wtA = await addWorktree(repo, "feat/a");
    const wtB = await addWorktree(repo, "feat/b");
    tempDirs.push(path.dirname(wtA), path.dirname(wtB));

    const states = await runDb(resolveRepoShipState(projectId, repo, wtB));
    expect(path.resolve(states[0]!.worktreePath!)).toBe(path.resolve(wtB));
    expect(states[0]!.worktreeBranch).toBe("feat/b");
  });
});

describe("evaluateShipReadiness", () => {
  function state(over: Partial<RepoShipState>): RepoShipState {
    return {
      name: "(default)",
      path: "/repo",
      implicit: true,
      baseBranch: "main",
      worktreePath: null,
      worktreeBranch: null,
      dirty: false,
      ...over,
    };
  }

  it("does not block when no repo has a linked feature worktree", () => {
    // A dirty *base* checkout (no worktree) is intentionally left alone — the
    // explicit close confirmation is the guard for non-worktree flows.
    const verdict = evaluateShipReadiness([state({}), state({ name: "api", dirty: true })]);
    expect(verdict.blocked).toBe(false);
    expect(verdict.reasons).toEqual([]);
  });

  it("blocks on a still-linked clean feature worktree (ship cleanup not run)", () => {
    const verdict = evaluateShipReadiness([
      state({ name: "front", worktreePath: "/wt/feat", worktreeBranch: "feat/x" }),
    ]);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reasons[0]).toMatch(/front/);
    expect(verdict.reasons[0]).toMatch(/feat\/x/);
  });

  it("flags uncommitted changes in the feature worktree distinctly", () => {
    const verdict = evaluateShipReadiness([
      state({ name: "front", worktreePath: "/wt/feat", worktreeBranch: "feat/x", dirty: true }),
    ]);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reasons[0]).toMatch(/uncommitted/);
  });

  describe("integrated with resolveRepoShipState", () => {
    let db: Database;
    let runDb: ReturnType<typeof makeRun>;
    let projectId: string;
    const tempDirs: string[] = [];

    beforeEach(async () => {
      db = createTestDb().db;
      runDb = makeRun(db);
      projectId = (await runDb(createProject({ name: "ship-gate" }))).id;
    });

    afterEach(async () => {
      for (const dir of tempDirs.splice(0)) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("blocks when a live feature worktree is still linked", async () => {
      const repo = await makeGitRepo();
      tempDirs.push(repo);
      const wt = await addWorktree(repo, "feat/ship");
      tempDirs.push(path.dirname(wt));
      const states = await runDb(resolveRepoShipState(projectId, repo, null));
      expect(evaluateShipReadiness(states).blocked).toBe(true);
    });

    it("does not block a clean repo with no feature worktree", async () => {
      const repo = await makeGitRepo();
      tempDirs.push(repo);
      const states = await runDb(resolveRepoShipState(projectId, repo, null));
      expect(evaluateShipReadiness(states).blocked).toBe(false);
    });
  });
});
