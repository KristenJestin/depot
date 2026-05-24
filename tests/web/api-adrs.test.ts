import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { projects, prds, adrs } from "#/db/schema";
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
const projectId = "proj-adrs-1";
const otherProjectId = "proj-adrs-2";

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  await db.insert(projects).values([
    { id: projectId, name: "ADR Project" },
    { id: otherProjectId, name: "Other Project" },
  ]);
  await db.insert(prds).values([
    { id: "prd-adr-1", projectId },
    { id: "prd-other", projectId: otherProjectId },
  ]);
  await db.insert(adrs).values([
    {
      id: "adr-1",
      projectId,
      prdId: "prd-adr-1",
      number: 1,
      title: "Use SQLite",
      status: "accepted",
      body: "# Decision\n\nWe pick SQLite.",
      supersededByAdrId: "adr-3",
    },
    {
      id: "adr-2",
      projectId,
      prdId: null,
      number: 2,
      title: "Hex IDs",
      status: "proposed",
      body: "Use hex IDs.",
    },
    {
      id: "adr-3",
      projectId,
      prdId: "prd-adr-1",
      number: 3,
      title: "Replace SQLite with libsql",
      status: "accepted",
      body: "Supersedes ADR-0001",
    },
    {
      id: "adr-1-superseded",
      projectId,
      prdId: null,
      number: 4,
      title: "Old decision",
      status: "superseded",
      body: "Was the first plan",
    },
    {
      id: "adr-other",
      projectId: otherProjectId,
      prdId: null,
      number: 1,
      title: "Other project decision",
      status: "proposed",
      body: "Belongs to another project",
    },
  ]);
  // Set up superseded → adr-1 relation backref
  const { eq } = await import("drizzle-orm");
  await db.update(adrs).set({ supersededByAdrId: "adr-1" }).where(eq(adrs.id, "adr-1-superseded"));
});

describe("web api — adrs", () => {
  describe("GET /api/projects/:projectId/adrs", () => {
    it("returns the ADRs of the project ordered by number ascending", async () => {
      const res = await app.request(`/api/projects/${projectId}/adrs`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
      const ids = body.items.map((a: { id: string }) => a.id);
      expect(ids).toEqual(["adr-1", "adr-2", "adr-3", "adr-1-superseded"]);
    });

    it("does not leak ADRs from other projects", async () => {
      const res = await app.request(`/api/projects/${projectId}/adrs`);
      const body = await res.json();
      const ids = body.items.map((a: { id: string }) => a.id);
      expect(ids).not.toContain("adr-other");
    });

    it("filters by ?prdId=", async () => {
      const res = await app.request(`/api/projects/${projectId}/adrs?prdId=prd-adr-1`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.items.map((a: { id: string }) => a.id);
      expect(ids).toEqual(["adr-1", "adr-3"]);
    });

    it("filters by ?status=", async () => {
      const res = await app.request(`/api/projects/${projectId}/adrs?status=proposed`);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.items.map((a: { id: string }) => a.id);
      expect(ids).toEqual(["adr-2"]);
    });

    it("rejects an unknown status with 400", async () => {
      const res = await app.request(`/api/projects/${projectId}/adrs?status=bogus`);
      expect(res.status).toBe(400);
    });

    it("combines prdId and status filters", async () => {
      const res = await app.request(
        `/api/projects/${projectId}/adrs?prdId=prd-adr-1&status=accepted`,
      );
      const body = await res.json();
      const ids = body.items.map((a: { id: string }) => a.id);
      expect(ids).toEqual(["adr-1", "adr-3"]);
    });
  });

  describe("GET /api/adrs/:id", () => {
    it("returns 404 for an unknown id", async () => {
      const res = await app.request("/api/adrs/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns the ADR with its body, status, prdId and superseding relations", async () => {
      const res = await app.request("/api/adrs/adr-1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.adr.id).toBe("adr-1");
      expect(body.adr.title).toBe("Use SQLite");
      expect(body.adr.status).toBe("accepted");
      expect(body.adr.body).toContain("# Decision");
      expect(body.adr.prdId).toBe("prd-adr-1");
      expect(body.adr.number).toBe(1);
      // adr-1 was superseded by adr-3
      expect(body.supersededBy).not.toBeNull();
      expect(body.supersededBy.id).toBe("adr-3");
      // adr-1 itself supersedes adr-1-superseded
      expect(body.supersedes).not.toBeNull();
      expect(body.supersedes.id).toBe("adr-1-superseded");
    });

    it("returns nulls for supersedes / supersededBy when there is no chain", async () => {
      const res = await app.request("/api/adrs/adr-2");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.adr.id).toBe("adr-2");
      expect(body.adr.prdId).toBeNull();
      expect(body.supersededBy).toBeNull();
      expect(body.supersedes).toBeNull();
    });
  });
});
