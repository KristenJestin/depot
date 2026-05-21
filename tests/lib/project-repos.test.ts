import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import {
  addRepo,
  listRepos,
  getRepo,
  removeRepo,
  resolveRepoFromPath,
  resolveProjectRepos,
} from "#/modules/projects/repos";
import { assertRepoRegistered, assertShaExists } from "#/lib/repo-guard";
import type { Database } from "#/db/client";

async function makeGitRepo(): Promise<{ root: string; sha: string }> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "depot-repo-test-"));
  const realRoot = await fs.realpath(root);
  execFileSync("git", ["init", "-q"], { cwd: realRoot });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: realRoot });
  execFileSync("git", ["config", "user.name", "t"], { cwd: realRoot });
  await fs.writeFile(path.join(realRoot, "f.txt"), "hello");
  execFileSync("git", ["add", "."], { cwd: realRoot });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: realRoot });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: realRoot }).toString().trim();
  return { root: realRoot, sha };
}

describe("project repos", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;
  const tempDirs: string[] = [];

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

  it("adds, lists, gets and removes repos", async () => {
    const repo = await run(addRepo({ projectId, name: "api", path: "/tmp/api", isPrimary: true }));
    expect(repo.name).toBe("api");
    expect(repo.baseBranch).toBe("main");
    expect(repo.isPrimary).toBe(true);

    await run(addRepo({ projectId, name: "front", path: "/tmp/front", baseBranch: "develop" }));
    const list = await run(listRepos(projectId));
    expect(list.map((r) => r.name)).toEqual(["api", "front"]);

    const fetched = await run(getRepo(projectId, "front"));
    expect(fetched?.baseBranch).toBe("develop");

    await run(removeRepo(repo.id));
    expect((await run(listRepos(projectId))).map((r) => r.name)).toEqual(["front"]);
  });

  it("rejects duplicate repo names within a project", async () => {
    await run(addRepo({ projectId, name: "api", path: "/tmp/api" }));
    await expect(run(addRepo({ projectId, name: "api", path: "/tmp/other" }))).rejects.toThrow(
      /already registered/,
    );
  });

  it("resolveProjectRepos returns an implicit repo for a mono-repo project", async () => {
    const gitRepo = await makeGitRepo();
    tempDirs.push(gitRepo.root);
    const repos = await run(resolveProjectRepos(projectId, gitRepo.root));
    expect(repos).toHaveLength(1);
    expect(repos[0]?.implicit).toBe(true);
    expect(repos[0]?.name).toBe("(default)");
    expect(repos[0]?.path).toBe(gitRepo.root);
    expect(repos[0]?.baseBranch).toBe("main");
    expect(repos[0]?.id).toBeNull();
  });

  it("resolveProjectRepos returns the registered repos for a multi-repo project", async () => {
    await run(addRepo({ projectId, name: "api", path: "/tmp/api", isPrimary: true }));
    await run(addRepo({ projectId, name: "front", path: "/tmp/front" }));
    const repos = await run(resolveProjectRepos(projectId, "/tmp"));
    expect(repos).toHaveLength(2);
    expect(repos.every((r) => !r.implicit)).toBe(true);
    expect(repos.map((r) => r.name).sort()).toEqual(["api", "front"]);
  });

  it("resolveRepoFromPath matches a registered repo by git root", async () => {
    const gitRepo = await makeGitRepo();
    tempDirs.push(gitRepo.root);
    await run(addRepo({ projectId, name: "api", path: gitRepo.root }));
    const matched = await run(resolveRepoFromPath(projectId, gitRepo.root));
    expect(matched?.name).toBe("api");
  });

  it("resolveRepoFromPath returns null for an unregistered repo", async () => {
    const registered = await makeGitRepo();
    const other = await makeGitRepo();
    tempDirs.push(registered.root, other.root);
    await run(addRepo({ projectId, name: "api", path: registered.root }));
    const matched = await run(resolveRepoFromPath(projectId, other.root));
    expect(matched).toBeNull();
  });

  it("guard accepts the implicit repo for a mono-repo project", async () => {
    const gitRepo = await makeGitRepo();
    tempDirs.push(gitRepo.root);
    const resolved = await run(assertRepoRegistered(projectId, gitRepo.root, gitRepo.root));
    expect(resolved.implicit).toBe(true);
  });

  it("guard refuses an unregistered repo in a multi-repo project", async () => {
    const registered = await makeGitRepo();
    const foreign = await makeGitRepo();
    tempDirs.push(registered.root, foreign.root);
    await run(addRepo({ projectId, name: "api", path: registered.root }));
    await expect(
      run(assertRepoRegistered(projectId, foreign.root, registered.root)),
    ).rejects.toThrow(/not registered/);
  });

  it("assertShaExists accepts a real SHA and rejects an unknown one", async () => {
    const gitRepo = await makeGitRepo();
    tempDirs.push(gitRepo.root);
    await expect(run(assertShaExists(gitRepo.root, gitRepo.sha))).resolves.toBeUndefined();
    await expect(
      run(assertShaExists(gitRepo.root, "0000000000000000000000000000000000000000")),
    ).rejects.toThrow(/does not exist/);
  });
});
