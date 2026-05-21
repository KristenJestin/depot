import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { projects, prds, prdRevisions, projectRepos, prdMerges, workspaces } from "#/db/schema";
import { createTestDb } from "../helpers/db";

vi.mock("#/services/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/services/database")>();
  return {
    ...actual,
    getDb: vi.fn<() => Promise<Database>>(),
    getRuntime: vi.fn<() => ManagedRuntime.ManagedRuntime<Db, never>>(),
  };
});

import { getDb, getRuntime, Db } from "#/services/database";
import app from "#/web/api";

const { db } = createTestDb();
const tempDirs: string[] = [];

/** Create a real git repo with one extra commit; returns root + both SHAs. */
async function makeGitRepo(
  label: string,
): Promise<{ root: string; first: string; second: string }> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), `depot-diffapi-${label}-`));
  const root = await fs.realpath(dir);
  tempDirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "feature"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  await fs.writeFile(path.join(root, `${label}.txt`), "one\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
  await fs.writeFile(path.join(root, `${label}.txt`), "one\ntwo\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "second"], { cwd: root });
  const second = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root }).toString().trim();
  // Leave an uncommitted change so working-tree diffs are non-empty.
  await fs.writeFile(path.join(root, `${label}.txt`), "one\ntwo\nthree\n");
  return { root, first, second };
}

let mono: Awaited<ReturnType<typeof makeGitRepo>>;
let front: Awaited<ReturnType<typeof makeGitRepo>>;
let api: Awaited<ReturnType<typeof makeGitRepo>>;

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  mono = await makeGitRepo("mono");
  front = await makeGitRepo("front");
  api = await makeGitRepo("api");

  await db.insert(projects).values([
    { id: "p-mono", name: "Mono" },
    { id: "p-multi", name: "Multi" },
  ]);
  await db.insert(workspaces).values([
    { id: "ws-mono", projectId: "p-mono", path: mono.root, label: "mono" },
    { id: "ws-multi", projectId: "p-multi", path: front.root, label: "multi" },
  ]);
  await db.insert(projectRepos).values([
    { id: "r-front", projectId: "p-multi", name: "front", path: front.root, isPrimary: true },
    { id: "r-api", projectId: "p-multi", name: "api", path: api.root, isPrimary: false },
  ]);
  await db.insert(prds).values([
    { id: "prd-mono", projectId: "p-mono", currentRevisionId: "rev-mono" },
    { id: "prd-multi", projectId: "p-multi", currentRevisionId: "rev-multi" },
  ]);
  await db.insert(prdRevisions).values([
    {
      id: "rev-mono",
      prdId: "prd-mono",
      projectId: "p-mono",
      workspaceId: "ws-mono",
      revision: 1,
      title: "Mono PRD",
      status: "in_progress",
      // Legacy single-SHA anchor — no `prd_merge` row, exercising the
      // diff API's legacy fallback for mono-repo projects.
      mergedAtSha: mono.second,
      updatedAt: new Date(),
    },
    {
      id: "rev-multi",
      prdId: "prd-multi",
      projectId: "p-multi",
      workspaceId: "ws-multi",
      revision: 1,
      title: "Multi PRD",
      status: "in_progress",
      updatedAt: new Date(),
    },
  ]);
  await db.insert(prdMerges).values([
    {
      id: "m-front",
      prdRevisionId: "rev-multi",
      repoId: "r-front",
      repoName: "front",
      repoPath: front.root,
      mergeSha: front.second,
      capturedFrom: "explicit",
    },
    {
      id: "m-api",
      prdRevisionId: "rev-multi",
      repoId: "r-api",
      repoName: "api",
      repoPath: api.root,
      mergeSha: api.second,
      capturedFrom: "explicit",
    },
  ]);
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("GET /api/prds/:id/diff — multi-repo aggregation", () => {
  it("mono-repo working-tree diff returns a single implicit repo", async () => {
    const res = await app.request("/api/prds/rev-mono/diff");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("working-tree");
    expect(Array.isArray(body.repos)).toBe(true);
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].repoName).toBe("(default)");
    expect(body.repos[0].diff).toContain("three");
    // Backward-compat top-level fields mirror the first repo.
    expect(body.diff).toBe(body.repos[0].diff);
  });

  it("multi-repo working-tree diff returns one entry per project_repo", async () => {
    const res = await app.request("/api/prds/rev-multi/diff");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("working-tree");
    expect(body.repos.map((r: { repoName: string }) => r.repoName).sort()).toEqual([
      "api",
      "front",
    ]);
    const frontRepo = body.repos.find((r: { repoName: string }) => r.repoName === "front");
    const apiRepo = body.repos.find((r: { repoName: string }) => r.repoName === "api");
    expect(frontRepo.diff).toContain("front.txt");
    expect(apiRepo.diff).toContain("api.txt");
  });

  it("multi-repo post-merge diff aggregates one git-show per prd_merge", async () => {
    const res = await app.request("/api/prds/rev-multi/diff?full=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("full");
    expect(body.repos).toHaveLength(2);
    const frontRepo = body.repos.find((r: { repoName: string }) => r.repoName === "front");
    expect(frontRepo.sha).toBe(front.second);
    expect(frontRepo.diff).toContain("two");
    const apiRepo = body.repos.find((r: { repoName: string }) => r.repoName === "api");
    expect(apiRepo.sha).toBe(api.second);
  });

  it("mono-repo post-merge diff falls back to the legacy mergedAtSha range", async () => {
    // No prd_merge rows for the mono PRD — exercise the legacy fallback path
    // that diffs `mergedAtSha^..mergedAtSha` on the implicit repo.
    const res = await app.request("/api/prds/rev-mono/diff?full=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("full");
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].repoName).toBe("(default)");
    expect(body.repos[0].sha).toBe(mono.second);
    expect(body.repos[0].diff).toContain("two");
  });
});

describe("git-status / commit / push — repo param", () => {
  it("git-status targets a named repo in a multi-repo project", async () => {
    const res = await app.request("/api/prds/rev-multi/git-status?repo=api");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.repo).toBe("api");
    expect(body.files.some((f: { path: string }) => f.path === "api.txt")).toBe(true);
  });

  it("git-status rejects an unknown repo name", async () => {
    const res = await app.request("/api/prds/rev-multi/git-status?repo=nope");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unknown repo");
  });

  it("mono-repo git-status works with no repo param (implicit repo)", async () => {
    const res = await app.request("/api/prds/rev-mono/git-status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.repo).toBe("(default)");
  });

  it("commit targets the named repo and records it in the response", async () => {
    const res = await app.request("/api/prds/rev-multi/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test(api): commit api change", repo: "api" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.repo).toBe("api");
    expect(body.filesChanged).toBeGreaterThan(0);
    // The change landed in the api repo, not front.
    const log = execFileSync("git", ["-C", api.root, "log", "-1", "--pretty=%s"]).toString().trim();
    expect(log).toBe("test(api): commit api change");
  });

  it("commit refuses to write to a repo sitting on its base branch", async () => {
    // Move the front repo onto `main` (a protected base branch).
    execFileSync("git", ["-C", front.root, "checkout", "-q", "-b", "main"]);
    const res = await app.request("/api/prds/rev-multi/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test(front): blocked", repo: "front" }),
    });
    expect(res.status).toBe(403);
    execFileSync("git", ["-C", front.root, "checkout", "-q", "feature"]);
  });
});
