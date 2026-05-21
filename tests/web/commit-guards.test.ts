import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Layer, ManagedRuntime } from "effect";
import { eq } from "drizzle-orm";
import type { Database } from "#/db/client";
import { projects, prds, prdRevisions, projectConfig, workspaces } from "#/db/schema";
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
let repoRoot: string;

/** Real git repo on a feature branch with one committed file. */
async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-commit-guard-"));
  const root = await fs.realpath(dir);
  tempDirs.push(root);
  execFileSync("git", ["init", "-q", "-b", "feature"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: root });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  await fs.writeFile(path.join(root, "app.txt"), "one\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  return root;
}

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  repoRoot = await makeRepo();

  await db.insert(projects).values({ id: "p-guard", name: "Guard" });
  await db.insert(workspaces).values({
    id: "ws-guard",
    projectId: "p-guard",
    path: repoRoot,
    label: "guard",
  });
  await db.insert(prds).values({ id: "prd-guard", projectId: "p-guard" });
  await db.insert(prdRevisions).values({
    id: "rev-guard",
    prdId: "prd-guard",
    projectId: "p-guard",
    workspaceId: "ws-guard",
    revision: 1,
    title: "Guarded PRD",
    status: "in_progress",
    updatedAt: new Date(),
  });
  await db.update(prds).set({ currentRevisionId: "rev-guard" }).where(eq(prds.id, "prd-guard"));
  await db.insert(projectConfig).values({
    projectId: "p-guard",
    key: "protectedFiles",
    value: ".env,secrets,config/keys",
  });
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("POST /api/prds/:id/commit — guards", () => {
  it("refuses to commit a protected file from project_config", async () => {
    await fs.writeFile(path.join(repoRoot, ".env"), "SECRET=1\n");
    const res = await app.request("/api/prds/rev-guard/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test: leak", files: [".env"] }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("protected path");
    await fs.rm(path.join(repoRoot, ".env"));
  });

  it("refuses a protected file nested under a protected directory", async () => {
    await fs.mkdir(path.join(repoRoot, "config", "keys"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "config", "keys", "id_rsa"), "key\n");
    const res = await app.request("/api/prds/rev-guard/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test: leak key", files: ["config/keys/id_rsa"] }),
    });
    expect(res.status).toBe(403);
    await fs.rm(path.join(repoRoot, "config"), { recursive: true, force: true });
  });

  it("refuses to commit while sitting on a protected base branch", async () => {
    execFileSync("git", ["-C", repoRoot, "checkout", "-q", "-b", "main"]);
    try {
      const res = await app.request("/api/prds/rev-guard/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "test: on main" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("protected branch");
    } finally {
      execFileSync("git", ["-C", repoRoot, "checkout", "-q", "feature"]);
    }
  });

  it("commits an allowed file and logs git_commit with source 'human'", async () => {
    await fs.writeFile(path.join(repoRoot, "app.txt"), "one\ntwo\n");
    const res = await app.request("/api/prds/rev-guard/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "feat: allowed change", files: ["app.txt"] }),
    });
    expect(res.status).toBe(201);

    const events = await db.query.activityLog.findMany({
      where: { prdRevisionId: "rev-guard", eventType: "git_commit" },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.source === "human")).toBe(true);
  });
});

describe("POST /api/prds/:id/push — guards", () => {
  it("refuses to push from a protected base branch", async () => {
    execFileSync("git", ["-C", repoRoot, "checkout", "-q", "-b", "develop"]);
    try {
      const res = await app.request("/api/prds/rev-guard/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("protected branch");
    } finally {
      execFileSync("git", ["-C", repoRoot, "checkout", "-q", "feature"]);
    }
  });
});
