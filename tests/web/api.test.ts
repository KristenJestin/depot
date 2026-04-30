import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { projects, prds, prdRevisions, reviews, tasks, workspaces } from "#/db/schema";
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
const projectId = "proj-test-1";

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  await db.insert(projects).values({
    id: projectId,
    name: "Test Project",
  });
  await db.insert(prds).values([
    { id: "prd-1", projectId },
    { id: "prd-2", projectId },
  ]);
  await db.insert(workspaces).values({
    id: "ws-1",
    projectId,
    path: "D:\\Projects\\depot\\.depot-dev",
    label: "Dev workspace",
  });
  await db.insert(prdRevisions).values([
    {
      id: "rev-1",
      prdId: "prd-1",
      projectId,
      title: "First PRD",
      status: "draft",
      updatedAt: new Date(1000),
      revision: 1,
    },
    {
      id: "rev-2",
      prdId: "prd-2",
      projectId,
      workspaceId: "ws-1",
      title: "Second PRD",
      status: "in_progress",
      updatedAt: new Date(2000),
      revision: 1,
      auditCycles: 1,
      currentPhase: 2,
      activatedAt: new Date(1500),
    },
  ]);
  await db.update(prds).set({ currentRevisionId: "rev-1" }).where(eq(prds.id, "prd-1"));
  await db.update(prds).set({ currentRevisionId: "rev-2" }).where(eq(prds.id, "prd-2"));
  await db.insert(reviews).values({
    id: "review-1",
    prdRevisionId: "rev-2",
    type: "human",
    status: "in_progress",
    phaseNumber: 2,
    userFeedback: "Address the migration edge case.",
    createdAt: new Date(2500),
    updatedAt: new Date(2500),
  });
  await db.insert(tasks).values([
    {
      id: "task-1",
      prdRevisionId: "rev-2",
      position: 1,
      title: "Ship the redesign",
      description: "Intent:\nShip the redesign",
      descriptionFormat: "structured_v1",
      doneCriteria: "Redesign is shipped",
      dependsOn: "[]",
      effort: "m",
      status: "done",
      createdAt: new Date(2100),
      startedAt: new Date(2200),
      completedAt: new Date(2300),
    },
    {
      id: "task-2",
      prdRevisionId: "rev-2",
      position: 2,
      title: "Polish the drawer flow",
      description: "Intent:\nPolish the drawer flow",
      descriptionFormat: "structured_v1",
      doneCriteria: "Drawer flow is polished",
      dependsOn: "[]",
      effort: "s",
      status: "in_progress",
      createdAt: new Date(2400),
      startedAt: new Date(2450),
    },
    {
      id: "finding-1",
      prdRevisionId: "rev-2",
      position: 3,
      title: "Handle the blocked review path",
      description: "Intent:\nHandle the blocked review path",
      descriptionFormat: "structured_v1",
      doneCriteria: "Blocked review path handled",
      dependsOn: "[]",
      effort: "s",
      status: "pending",
      reviewId: "review-1",
      severity: "major",
      createdAt: new Date(2550),
    },
    {
      id: "finding-2",
      prdRevisionId: "rev-2",
      position: 4,
      title: "Close the empty state gap",
      description: "Intent:\nClose the empty state gap",
      descriptionFormat: "structured_v1",
      doneCriteria: "Empty state gap closed",
      dependsOn: "[]",
      effort: "xs",
      status: "done",
      reviewId: "review-1",
      severity: "minor",
      createdAt: new Date(2600),
      completedAt: new Date(2650),
    },
  ]);
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
    expect(body.workspaceId).toBeNull();
  });

  describe("GET /api/prds", () => {
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
      expect(body.prds[0].id).toBe("rev-2");
      expect(body.prds[1].id).toBe("rev-1");
    });
  });

  describe("GET /api/prds/:id", () => {
    it("retourne 404 pour un id inconnu", async () => {
      const res = await app.request("/api/prds/nonexistent");
      expect(res.status).toBe(404);
    });

    it("retourne le PRD avec ses tasks et review", async () => {
      const res = await app.request("/api/prds/rev-1");
      const body = await res.json();
      expect(body.prd.id).toBe("rev-1");
      expect(Array.isArray(body.tasks)).toBe(true);
    });
  });

  describe("GET /api/prds (enrichi)", () => {
    it("inclut totalTasks et doneTasks (0 si aucune task)", async () => {
      const res = await app.request("/api/prds");
      expect(res.status).toBe(200);
      const { prds } = await res.json();
      const draftPrd = prds.find((prd: { id: string }) => prd.id === "rev-1");
      expect(draftPrd).toBeDefined();
      expect(typeof draftPrd.totalTasks).toBe("number");
      expect(typeof draftPrd.doneTasks).toBe("number");
      expect(draftPrd.totalTasks).toBe(0);
      expect(draftPrd.doneTasks).toBe(0);
    });

    it("inclut latestReview et previewTasks pour les PRD en review", async () => {
      const res = await app.request("/api/prds");
      expect(res.status).toBe(200);
      const { prds } = await res.json();
      const activePrd = prds.find((prd: { id: string }) => prd.id === "rev-2");

      expect(activePrd).toMatchObject({
        totalTasks: 2,
        doneTasks: 1,
        inProgressTasks: 1,
        blockedTasks: 0,
        skippedTasks: 0,
        latestReview: {
          id: "review-1",
          status: "in_progress",
          findingsCount: 2,
          resolvedCount: 1,
          pendingCount: 1,
          majorCount: 1,
          minorCount: 1,
        },
      });
      expect(activePrd.previewTasks).toEqual([
        {
          id: "finding-2",
          title: "Close the empty state gap",
          status: "done",
        },
        {
          id: "finding-1",
          title: "Handle the blocked review path",
          status: "pending",
        },
      ]);
    });
  });

  describe("GET /api/prds/:id (enrichi)", () => {
    it("retourne workspace et phaseNumber pour les reviews", async () => {
      const res = await app.request("/api/prds/rev-2");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.workspace).toMatchObject({
        id: "ws-1",
        path: "D:\\Projects\\depot\\.depot-dev",
        label: "Dev workspace",
      });
      expect(body.reviews).toContainEqual(
        expect.objectContaining({
          id: "review-1",
          phaseNumber: 2,
          userFeedback: "Address the migration edge case.",
        }),
      );
    });
  });

  describe("GET /api/activity", () => {
    it("retourne { events: [] } quand aucun événement", async () => {
      const res = await app.request("/api/activity");
      expect(res.status).toBe(200);
      const { events } = await res.json();
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe("GET /api/sessions/current", () => {
    it("retourne { session: null }", async () => {
      const res = await app.request("/api/sessions/current");
      expect(res.status).toBe(200);
      const { session } = await res.json();
      expect(session).toBeNull();
    });
  });

  describe("GET /api/context (enrichi)", () => {
    it("retourne workspaceId et workspacePath null si aucun workspace courant", async () => {
      const res = await app.request("/api/context");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspaceId).toBeNull();
      expect(body.workspacePath).toBeNull();
    });
  });

  describe("GET /api/workspaces", () => {
    it("retourne { workspaces: [] } quand aucun workspace existe", async () => {
      const res = await app.request("/api/workspaces");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.workspaces)).toBe(true);
    });
  });

  describe("PATCH /api/context", () => {
    it("accepte workspaceId null et retourne workspaceId null", async () => {
      const res = await app.request("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: null }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspaceId).toBeNull();
    });

    it("rejette un body invalide avec 400", async () => {
      const res = await app.request("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: 42 }),
      });
      expect(res.status).toBe(400);
    });
  });
});
