import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Layer, ManagedRuntime } from "effect";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    it("filtre par ?repo=<name> et expose repoName par événement", async () => {
      // Seed direct rows to keep the test independent of any auto-logged
      // event from other fixtures. The schema's nullable `repoName` keeps
      // the third row (no repo) representing the historical / mono-repo case.
      const { activityLog } = await import("#/db/schema");
      await db.insert(activityLog).values([
        {
          id: "evt-api-1",
          projectId,
          eventType: "note",
          payload: JSON.stringify({ message: "api-only" }),
          repoName: "api-repo",
        },
        {
          id: "evt-front-1",
          projectId,
          eventType: "note",
          payload: JSON.stringify({ message: "front-only" }),
          repoName: "front-repo",
        },
        {
          id: "evt-legacy",
          projectId,
          eventType: "note",
          payload: JSON.stringify({ message: "legacy" }),
          repoName: null,
        },
      ]);
      try {
        const filtered = await app.request("/api/activity?repo=api-repo");
        expect(filtered.status).toBe(200);
        const filteredBody = await filtered.json();
        const filteredIds = filteredBody.events.map((e: { id: string }) => e.id);
        expect(filteredIds).toContain("evt-api-1");
        expect(filteredIds).not.toContain("evt-front-1");
        expect(filteredIds).not.toContain("evt-legacy");

        const all = await app.request("/api/activity");
        const allBody = await all.json();
        const allIds = allBody.events.map((e: { id: string }) => e.id);
        expect(allIds).toContain("evt-api-1");
        expect(allIds).toContain("evt-front-1");
        expect(allIds).toContain("evt-legacy");
        // The repoName field is exposed per event.
        const apiEvent = allBody.events.find((e: { id: string }) => e.id === "evt-api-1");
        expect(apiEvent.repoName).toBe("api-repo");
        const legacyEvent = allBody.events.find((e: { id: string }) => e.id === "evt-legacy");
        expect(legacyEvent.repoName).toBeNull();
      } finally {
        const { eq: drizzleEq, inArray: drizzleInArray } = await import("drizzle-orm");
        await db
          .delete(activityLog)
          .where(drizzleInArray(activityLog.id, ["evt-api-1", "evt-front-1", "evt-legacy"]));
        void drizzleEq;
      }
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

    it("masque les workspaces orphelins par défaut", async () => {
      const liveDir = await fs.mkdtemp(join(tmpdir(), "depot-web-ws-default-"));
      try {
        await db.insert(workspaces).values([
          {
            id: "ws-live-default",
            projectId,
            path: liveDir,
            label: "live default",
          },
          {
            id: "ws-orphan-default",
            projectId,
            path: "/definitely/does/not/exist/orphan-default",
            label: "orphan default",
          },
        ]);

        const res = await app.request("/api/workspaces");
        expect(res.status).toBe(200);
        const body = await res.json();
        const ids = body.workspaces.map((w: { id: string }) => w.id);
        expect(ids).toContain("ws-live-default");
        expect(ids).not.toContain("ws-orphan-default");
      } finally {
        await db.delete(workspaces).where(eq(workspaces.id, "ws-live-default"));
        await db.delete(workspaces).where(eq(workspaces.id, "ws-orphan-default"));
        await fs.rm(liveDir, { recursive: true, force: true });
      }
    });

    it("retourne tous les workspaces avec isOrphan quand ?include_orphans=1", async () => {
      const liveDir = await fs.mkdtemp(join(tmpdir(), "depot-web-ws-opt-in-"));
      try {
        await db.insert(workspaces).values([
          {
            id: "ws-live-optin",
            projectId,
            path: liveDir,
            label: "live optin",
          },
          {
            id: "ws-orphan-optin",
            projectId,
            path: "/definitely/does/not/exist/orphan-optin",
            label: "orphan optin",
          },
        ]);

        const res = await app.request("/api/workspaces?include_orphans=1");
        expect(res.status).toBe(200);
        const body = await res.json();
        const live = body.workspaces.find((w: { id: string }) => w.id === "ws-live-optin");
        const orphan = body.workspaces.find((w: { id: string }) => w.id === "ws-orphan-optin");
        expect(live).toBeDefined();
        expect(orphan).toBeDefined();
        expect(live.isOrphan).toBe(false);
        expect(orphan.isOrphan).toBe(true);
      } finally {
        await db.delete(workspaces).where(eq(workspaces.id, "ws-live-optin"));
        await db.delete(workspaces).where(eq(workspaces.id, "ws-orphan-optin"));
        await fs.rm(liveDir, { recursive: true, force: true });
      }
    });

    it("expose isOrphan: false sur les workspaces non-orphelins même sans opt-in", async () => {
      const liveDir = await fs.mkdtemp(join(tmpdir(), "depot-web-ws-flag-"));
      try {
        await db.insert(workspaces).values({
          id: "ws-live-flag",
          projectId,
          path: liveDir,
          label: "live flag",
        });

        const res = await app.request("/api/workspaces");
        const body = await res.json();
        const live = body.workspaces.find((w: { id: string }) => w.id === "ws-live-flag");
        expect(live).toBeDefined();
        expect(live.isOrphan).toBe(false);
      } finally {
        await db.delete(workspaces).where(eq(workspaces.id, "ws-live-flag"));
        await fs.rm(liveDir, { recursive: true, force: true });
      }
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

    it("écrit un cookie depot_workspace_id réutilisable par les requêtes suivantes", async () => {
      const patchRes = await app.request("/api/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws-1" }),
      });
      expect(patchRes.status).toBe(200);
      const setCookie = patchRes.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(/depot_workspace_id=ws-1/);
      expect(setCookie).toMatch(/Path=\//i);
      expect(setCookie).toMatch(/SameSite=Lax/i);

      const getRes = await app.request("/api/context", {
        headers: { Cookie: "depot_workspace_id=ws-1" },
      });
      const ctx = await getRes.json();
      expect(ctx.workspaceId).toBe("ws-1");
    });

    it("le sentinel __cleared force workspaceId null sur GET /api/context", async () => {
      const res = await app.request("/api/context", {
        headers: { Cookie: "depot_workspace_id=__cleared" },
      });
      const body = await res.json();
      expect(body.workspaceId).toBeNull();
    });
  });

  describe("GET /api/prds — filtre par projet du workspace courant", () => {
    it("ne retourne que les PRDs du projet du workspace cookie quand un cookie est présent", async () => {
      // Seed a second project with its own PRD so we have data to filter against.
      const otherProjectId = "proj-other";
      await db.insert(projects).values({ id: otherProjectId, name: "Other Project" });
      await db.insert(prds).values({ id: "prd-other-1", projectId: otherProjectId });
      await db.insert(workspaces).values({
        id: "ws-other",
        projectId: otherProjectId,
        path: "/other/path",
        label: null,
      });
      await db.insert(prdRevisions).values({
        id: "rev-other",
        prdId: "prd-other-1",
        projectId: otherProjectId,
        title: "Other-project PRD",
        status: "draft",
        updatedAt: new Date(2000),
        revision: 1,
      });
      // Set the original test PRD to be the current revision so it shows up under latestOnly.
      await db
        .update(prds)
        .set({ currentRevisionId: "rev-other" })
        .where(eq(prds.id, "prd-other-1"));

      // With ws-1 cookie → only PRDs from projectId.
      const wsResp = await app.request("/api/prds", {
        headers: { Cookie: "depot_workspace_id=ws-1" },
      });
      const wsBody = await wsResp.json();
      const wsTitles = wsBody.prds.map((p: { title: string }) => p.title);
      expect(wsTitles).not.toContain("Other-project PRD");

      // With ws-other cookie → only Other-project PRD.
      const otherResp = await app.request("/api/prds", {
        headers: { Cookie: "depot_workspace_id=ws-other" },
      });
      const otherBody = await otherResp.json();
      const otherTitles = otherBody.prds.map((p: { title: string }) => p.title);
      expect(otherTitles).toContain("Other-project PRD");
      expect(otherTitles).not.toContain("First PRD");

      // With __cleared cookie → all PRDs (no filter).
      const allResp = await app.request("/api/prds", {
        headers: { Cookie: "depot_workspace_id=__cleared" },
      });
      const allBody = await allResp.json();
      expect(allBody.prds.length).toBeGreaterThanOrEqual(2);
    });
  });
});
