import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { projects, prds, prdRevisions, projectRepos, prdRepos, tasks } from "#/db/schema";
import { eq } from "drizzle-orm";
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
const multiProjectId = "proj-multi";
const monoProjectId = "proj-mono";

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  await db.insert(projects).values([
    { id: multiProjectId, name: "Multi" },
    { id: monoProjectId, name: "Mono" },
  ]);
  await db.insert(prds).values([
    { id: "prd-multi", projectId: multiProjectId },
    { id: "prd-mono", projectId: monoProjectId },
  ]);
  await db.insert(prdRevisions).values([
    {
      id: "rev-multi",
      prdId: "prd-multi",
      projectId: multiProjectId,
      title: "Multi-repo PRD",
      status: "draft",
      revision: 1,
    },
    {
      id: "rev-mono",
      prdId: "prd-mono",
      projectId: monoProjectId,
      title: "Mono-repo PRD",
      status: "draft",
      revision: 1,
    },
  ]);
  await db.update(prds).set({ currentRevisionId: "rev-multi" }).where(eq(prds.id, "prd-multi"));
  await db.update(prds).set({ currentRevisionId: "rev-mono" }).where(eq(prds.id, "prd-mono"));

  await db.insert(projectRepos).values([
    {
      id: "repo-api",
      projectId: multiProjectId,
      name: "api",
      path: "/tmp/api",
    },
    {
      id: "repo-front",
      projectId: multiProjectId,
      name: "front",
      path: "/tmp/front",
    },
    {
      id: "repo-docs",
      projectId: multiProjectId,
      name: "docs",
      path: "/tmp/docs",
    },
  ]);
});

describe("web api — prd repos", () => {
  describe("GET /api/prds/:id/repos", () => {
    it("returns 404 for unknown PRD id", async () => {
      const res = await app.request("/api/prds/does-not-exist/repos");
      expect(res.status).toBe(404);
    });

    it("returns empty items + full projectRepos list when nothing is declared", async () => {
      const res = await app.request("/api/prds/rev-multi/repos");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ id: string; name: string }>;
        projectRepos: Array<{ id: string; name: string }>;
        implicit: boolean;
      };
      expect(body.items).toEqual([]);
      expect(body.projectRepos.map((r) => r.name).sort()).toEqual(["api", "docs", "front"]);
      expect(body.implicit).toBe(false);
    });

    it("flags mono-repo projects with implicit: true and empty projectRepos", async () => {
      const res = await app.request("/api/prds/rev-mono/repos");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: unknown[];
        projectRepos: unknown[];
        implicit: boolean;
      };
      expect(body.items).toEqual([]);
      expect(body.projectRepos).toEqual([]);
      expect(body.implicit).toBe(true);
    });
  });

  describe("POST /api/prds/:id/repos", () => {
    it("returns 404 when PRD does not exist", async () => {
      const res = await app.request("/api/prds/does-not-exist/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "api" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 422 when body lacks repoName", async () => {
      const res = await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 with a clear error when the repo is not a project_repo of the project", async () => {
      const res = await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "ghost" }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not registered/i);
    });

    it("adds a project_repo to the PRD scope and returns 201", async () => {
      const res = await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "api" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { item: { repoId: string; prdRevisionId: string } };
      expect(body.item.repoId).toBe("repo-api");
      expect(body.item.prdRevisionId).toBe("rev-multi");

      const list = await app.request("/api/prds/rev-multi/repos");
      const listBody = (await list.json()) as { items: Array<{ id: string; name: string }> };
      expect(listBody.items.map((r) => r.name)).toContain("api");
    });

    it("is idempotent: posting the same repo twice returns the same row", async () => {
      const first = await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "front" }),
      });
      const firstBody = (await first.json()) as { item: { id: string } };
      const second = await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "front" }),
      });
      const secondBody = (await second.json()) as { item: { id: string } };
      expect(secondBody.item.id).toBe(firstBody.item.id);
    });
  });

  describe("DELETE /api/prds/:id/repos/:repoName", () => {
    it("returns 404 when PRD does not exist", async () => {
      const res = await app.request("/api/prds/does-not-exist/repos/api", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("returns 422 when the repo is not a project_repo of the project", async () => {
      const res = await app.request("/api/prds/rev-multi/repos/ghost", {
        method: "DELETE",
      });
      expect(res.status).toBe(422);
    });

    it("removes a repo from the PRD scope", async () => {
      // Ensure the link exists first.
      await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "docs" }),
      });

      const before = await app.request("/api/prds/rev-multi/repos");
      const beforeBody = (await before.json()) as { items: Array<{ name: string }> };
      expect(beforeBody.items.map((r) => r.name)).toContain("docs");

      const res = await app.request("/api/prds/rev-multi/repos/docs", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const after = await app.request("/api/prds/rev-multi/repos");
      const afterBody = (await after.json()) as { items: Array<{ name: string }> };
      expect(afterBody.items.map((r) => r.name)).not.toContain("docs");
    });

    it("is a no-op when the repo is not in the PRD scope", async () => {
      // Make sure `front` is detached.
      await app.request("/api/prds/rev-multi/repos/front", { method: "DELETE" });
      const res = await app.request("/api/prds/rev-multi/repos/front", {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
    });
  });

  describe("PATCH /api/prds/:id/tasks/:taskId — repoId update", () => {
    beforeAll(async () => {
      // Set up a fresh task on the multi-repo PRD plus a known prd_repo scope.
      // Reset prd_repo first so this block is independent of the POST tests above.
      await db.delete(prdRepos).where(eq(prdRepos.prdRevisionId, "rev-multi"));
      await db.insert(tasks).values({
        id: "task-multi-1",
        prdRevisionId: "rev-multi",
        position: 1,
        title: "Wire the API",
        description: "Intent:\nWire the API",
        descriptionFormat: "structured_v1",
        doneCriteria: "API wired",
        dependsOn: "[]",
        effort: "s",
        status: "pending",
      });
    });

    it("rejects setting a repoId that is not in the PRD scope", async () => {
      const res = await app.request("/api/prds/rev-multi/tasks/task-multi-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId: "repo-api" }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not in the PRD's repo scope/);
    });

    it("accepts a repoId once the repo is in the PRD scope and returns the updated task", async () => {
      await app.request("/api/prds/rev-multi/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoName: "api" }),
      });
      const res = await app.request("/api/prds/rev-multi/tasks/task-multi-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId: "repo-api" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { task: { id: string; repoId: string | null } };
      expect(body.task.repoId).toBe("repo-api");
    });

    it("clears the repoId when null is sent", async () => {
      const res = await app.request("/api/prds/rev-multi/tasks/task-multi-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId: null }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { task: { repoId: string | null } };
      expect(body.task.repoId).toBeNull();
    });

    it("returns 404 when the PRD does not exist", async () => {
      const res = await app.request("/api/prds/does-not-exist/tasks/task-multi-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId: null }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 when the task does not belong to the PRD", async () => {
      const res = await app.request("/api/prds/rev-mono/tasks/task-multi-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoId: null }),
      });
      expect(res.status).toBe(404);
    });
  });
});
