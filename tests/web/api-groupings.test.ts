import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Layer, ManagedRuntime } from "effect";

import type { Database } from "#/db/client";
import { projects, prds, prdRevisions, prdTags, workspaces } from "#/db/schema";
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

/**
 * PRD 0019 / T4 — API surface for groupings (tags / milestones / dependencies).
 *
 * The test seeds two PRDs in the same project, attaches a tag and a milestone
 * to one of them, then exercises the read endpoints + filters:
 *   - `GET /api/prds` returns `tags` + `targetVersion` per item.
 *   - `?tag=foo&milestone=2.6.1` intersects to the right PRD.
 *   - `GET /api/prds/:id` exposes `tags`, `targetVersion`, `dependencies`,
 *     `dependents`.
 *   - `GET /api/milestones/:version` returns the items + summary.
 */

const { db } = createTestDb();
const projectId = "proj-grp";

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  await db.insert(projects).values({ id: projectId, name: "Grouping Project" });
  await db.insert(prds).values([
    { id: "lprd-a", projectId, targetVersion: "2.6.1" },
    { id: "lprd-b", projectId },
  ]);
  await db.insert(workspaces).values({
    id: "ws-grp",
    projectId,
    path: process.cwd(),
    label: "grp",
  });
  await db.insert(prdRevisions).values([
    {
      id: "rev-a",
      prdId: "lprd-a",
      projectId,
      workspaceId: "ws-grp",
      title: "PRD A",
      status: "in_progress",
      updatedAt: new Date(3000),
      revision: 1,
    },
    {
      id: "rev-b",
      prdId: "lprd-b",
      projectId,
      workspaceId: "ws-grp",
      title: "PRD B",
      status: "draft",
      updatedAt: new Date(4000),
      revision: 1,
    },
  ]);
  await db.update(prds).set({ currentRevisionId: "rev-a" }).where(eq(prds.id, "lprd-a"));
  await db.update(prds).set({ currentRevisionId: "rev-b" }).where(eq(prds.id, "lprd-b"));
  await db.insert(prdTags).values([
    { prdId: "lprd-a", tag: "shipped" },
    { prdId: "lprd-a", tag: "tests-e2e" },
    { prdId: "lprd-b", tag: "tests-e2e" },
  ]);
});

describe("web api — PRD 0019 / T4 groupings", () => {
  it("GET /api/prds returns tags + targetVersion per item", async () => {
    const res = await app.request("/api/prds", {
      headers: { Cookie: "depot_workspace_id=ws-grp" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const a = body.prds.find((p: { id: string }) => p.id === "rev-a");
    const b = body.prds.find((p: { id: string }) => p.id === "rev-b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.tags).toEqual(["shipped", "tests-e2e"]);
    expect(a.targetVersion).toBe("2.6.1");
    expect(b.tags).toEqual(["tests-e2e"]);
    expect(b.targetVersion).toBeNull();
  });

  it("?tag=tests-e2e returns both PRDs that carry the tag", async () => {
    const res = await app.request("/api/prds?tag=tests-e2e", {
      headers: { Cookie: "depot_workspace_id=ws-grp" },
    });
    const body = await res.json();
    const ids = body.prds.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(["rev-a", "rev-b"]);
  });

  it("?tag=shipped&milestone=2.6.1 intersects to the one matching PRD", async () => {
    const res = await app.request("/api/prds?tag=shipped&milestone=2.6.1", {
      headers: { Cookie: "depot_workspace_id=ws-grp" },
    });
    const body = await res.json();
    expect(body.prds.length).toBe(1);
    expect(body.prds[0].id).toBe("rev-a");
  });

  it("GET /api/prds/:id exposes tags + targetVersion + dependencies + dependents", async () => {
    const res = await app.request("/api/prds/rev-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toEqual(["shipped", "tests-e2e"]);
    expect(body.targetVersion).toBe("2.6.1");
    expect(Array.isArray(body.dependencies)).toBe(true);
    expect(Array.isArray(body.dependents)).toBe(true);
  });

  it("GET /api/milestones/:version returns items + summary", async () => {
    const res = await app.request("/api/milestones/2.6.1", {
      headers: { Cookie: "depot_workspace_id=ws-grp" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.version).toBe("2.6.1");
    expect(body.summary.total).toBe(1);
    expect(body.summary.byStatus.in_progress).toBe(1);
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe("rev-a");
  });
});
