import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Database } from "#/db/client";
import { projects, prds } from "#/db/schema";
import { createTestDb } from "../helpers/db";

vi.mock("#/services/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/services/database")>();
  return { ...actual, getDb: vi.fn<() => Promise<Database>>() };
});

import { getDb } from "#/services/database";
import app from "#/web/api";

const { db } = createTestDb();

beforeAll(() => {
  vi.mocked(getDb).mockResolvedValue(db);
});

describe("web api", () => {
  it("GET /api/ping returns 200 { ok: true }", async () => {
    const res = await app.request("/api/ping");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("GET /api/context returns { workspaceId: null } when no workspace matches cwd", async () => {
    const res = await app.request("/api/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ workspaceId: null });
  });

  describe("GET /api/prds", () => {
    beforeAll(async () => {
      const projectId = "proj-test-1";
      await db.insert(projects).values({
        id: projectId,
        name: "Test Project",
      });
      await db.insert(prds).values([
        {
          id: "prd-1",
          projectId,
          title: "First PRD",
          status: "draft",
          updatedAt: new Date(1000),
        },
        {
          id: "prd-2",
          projectId,
          title: "Second PRD",
          status: "in_progress",
          updatedAt: new Date(2000),
        },
      ]);
    });

    it("returns 200 with prds array", async () => {
      const res = await app.request("/api/prds");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.prds)).toBe(true);
      expect(body.prds.length).toBe(2);
    });

    it("prds sont triés par updatedAt desc", async () => {
      const res = await app.request("/api/prds");
      const body = await res.json();
      expect(body.prds[0].id).toBe("prd-2");
      expect(body.prds[1].id).toBe("prd-1");
    });
  });

  describe("GET /api/prds/:id", () => {
    it("retourne 404 pour un id inconnu", async () => {
      const res = await app.request("/api/prds/nonexistent");
      expect(res.status).toBe(404);
    });

    it("retourne le PRD avec ses tasks et review", async () => {
      const res = await app.request("/api/prds/prd-1");
      const body = await res.json();
      expect(body.prd.id).toBe("prd-1");
      expect(Array.isArray(body.tasks)).toBe(true);
    });
  });
});
