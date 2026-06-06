import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd } from "#/modules/prds/domain";
import { createIdea, linkIdeaToPrd, promoteIdea } from "#/modules/ideas/domain";

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
const run = makeRun(db);

let projectId: string;
let otherProjectId: string;
let openIdeaId: string;
let taggedIdeaId: string;
let promotedIdeaId: string;
let promotedPrdRevisionId: string;
let droppedIdeaId: string;
let prdRevisionId: string; // a PRD with a linked (still-open) source idea
let linkedSourceIdeaId: string;

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  projectId = (await run(createProject({ name: "ideas-web" }))).id;
  otherProjectId = (await run(createProject({ name: "ideas-web-other" }))).id;

  // Newest-first ordering: created in this order, so `taggedIdea` is newest.
  const open = await run(createIdea({ projectId, title: "Plain open idea", body: "the body" }));
  openIdeaId = open.id;

  const dropped = await run(createIdea({ projectId, title: "To drop" }));
  droppedIdeaId = dropped.id;
  const { eq } = await import("drizzle-orm");
  const { ideas } = await import("#/db/schema");
  await db
    .update(ideas)
    .set({ status: "dropped", droppedReason: "no longer relevant" })
    .where(eq(ideas.id, dropped.id));

  // An idea we promote → flips to `promoted`, gets a draft PRD + promotedPrdId.
  const toPromote = await run(createIdea({ projectId, title: "Promote me", body: "raw need" }));
  const promoted = await run(promoteIdea(toPromote.id));
  promotedIdeaId = promoted.idea.id;
  promotedPrdRevisionId = promoted.prd.id; // the new draft revision row

  const tagged = await run(createIdea({ projectId, title: "Tagged idea", tag: "plugins" }));
  taggedIdeaId = tagged.id;

  // An idea on the *other* project — must never leak into this project's list.
  await run(createIdea({ projectId: otherProjectId, title: "Other project idea" }));

  // A separate PRD with a still-open source idea linked via `prd idea add`
  // (referencing ≠ committing — the idea stays `open`).
  prdRevisionId = (await run(createPrd({ projectId, title: "PRD with source idea" }))).id;
  const linked = await run(
    createIdea({ projectId, title: "Motivating idea", body: "why we build" }),
  );
  linkedSourceIdeaId = linked.id;
  await run(linkIdeaToPrd(prdRevisionId, linked.id));
});

describe("web api — ideas (PRD 0027 / T7)", () => {
  describe("GET /api/projects/:projectId/ideas", () => {
    it("lists the project's open ideas newest-first with an openCount", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ideas: Array<{ id: string; status: string; createdAt: string }>;
        openCount: number;
      };
      // Default status is open. Three open ideas remain (the promote-target
      // flipped to `promoted`, the dropped one to `dropped`).
      const ids = body.ideas.map((i) => i.id);
      expect(new Set(ids)).toEqual(new Set([taggedIdeaId, linkedSourceIdeaId, openIdeaId]));
      expect(body.ideas.every((i) => i.status === "open")).toBe(true);
      // Newest-first: createdAt descending, id descending as the tie-breaker
      // (the domain orders by { createdAt: "desc", id: "desc" }).
      const sorted = [...body.ideas].sort((a, b) => {
        const byTime = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return byTime !== 0 ? byTime : b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
      });
      expect(ids).toEqual(sorted.map((i) => i.id));
      // openCount is project-wide regardless of filter.
      expect(body.openCount).toBe(3);
    });

    it("does not leak ideas from other projects", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas`);
      const body = (await res.json()) as { ideas: Array<{ title: string }> };
      expect(body.ideas.map((i) => i.title)).not.toContain("Other project idea");
    });

    it("filters by ?status=promoted and decorates the head revision id", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?status=promoted`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ideas: Array<{
          id: string;
          status: string;
          promotedPrdId: string | null;
          promotedPrdRevisionId: string | null;
        }>;
        openCount: number;
      };
      expect(body.ideas.map((i) => i.id)).toEqual([promotedIdeaId]);
      expect(body.ideas[0]!.status).toBe("promoted");
      expect(body.ideas[0]!.promotedPrdId).not.toBeNull();
      expect(body.ideas[0]!.promotedPrdRevisionId).toBe(promotedPrdRevisionId);
      // openCount stays project-wide even when filtered to promoted.
      expect(body.openCount).toBe(3);
    });

    it("filters by ?status=dropped", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?status=dropped`);
      const body = (await res.json()) as { ideas: Array<{ id: string; droppedReason: string }> };
      expect(body.ideas.map((i) => i.id)).toEqual([droppedIdeaId]);
      expect(body.ideas[0]!.droppedReason).toBe("no longer relevant");
    });

    it("filters by ?tag=", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?tag=plugins`);
      const body = (await res.json()) as { ideas: Array<{ id: string; tag: string }> };
      expect(body.ideas.map((i) => i.id)).toEqual([taggedIdeaId]);
      expect(body.ideas[0]!.tag).toBe("plugins");
    });

    it("decorates each idea with its linkedPrds (empty when none)", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas`);
      const body = (await res.json()) as {
        ideas: Array<{
          id: string;
          linkedPrds: Array<{ revisionId: string; prdId: string; title: string }>;
        }>;
      };
      const byId = new Map(body.ideas.map((i) => [i.id, i]));
      // The motivating idea is linked to the "PRD with source idea" revision.
      const linked = byId.get(linkedSourceIdeaId)!;
      expect(linked.linkedPrds.map((p) => p.revisionId)).toEqual([prdRevisionId]);
      expect(linked.linkedPrds[0]!.title).toBe("PRD with source idea");
      expect(typeof linked.linkedPrds[0]!.prdId).toBe("string");
      // A plain open idea has no linked PRDs.
      expect(byId.get(openIdeaId)!.linkedPrds).toEqual([]);
    });

    it("filters by ?mapped=true (only ideas with ≥1 linked PRD)", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?mapped=true`);
      const body = (await res.json()) as {
        ideas: Array<{ id: string; linkedPrds: unknown[] }>;
      };
      // Among the open ideas, only the motivating idea is mapped.
      expect(body.ideas.map((i) => i.id)).toEqual([linkedSourceIdeaId]);
      expect(body.ideas.every((i) => i.linkedPrds.length > 0)).toBe(true);
    });

    it("filters by ?mapped=false (only unmapped ideas)", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?mapped=false`);
      const body = (await res.json()) as {
        ideas: Array<{ id: string; linkedPrds: unknown[] }>;
      };
      expect(new Set(body.ideas.map((i) => i.id))).toEqual(new Set([taggedIdeaId, openIdeaId]));
      expect(body.ideas.every((i) => i.linkedPrds.length === 0)).toBe(true);
    });

    it("composes ?mapped=true with ?status=promoted", async () => {
      // The promoted idea is auto-linked to its draft PRD, so it is mapped.
      const res = await app.request(`/api/projects/${projectId}/ideas?status=promoted&mapped=true`);
      const body = (await res.json()) as { ideas: Array<{ id: string }> };
      expect(body.ideas.map((i) => i.id)).toEqual([promotedIdeaId]);
    });

    it("composes ?mapped=false with ?status=open", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?status=open&mapped=false`);
      const body = (await res.json()) as { ideas: Array<{ id: string }> };
      expect(new Set(body.ideas.map((i) => i.id))).toEqual(new Set([taggedIdeaId, openIdeaId]));
    });

    it("rejects an unknown status with 400", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?status=bogus`);
      expect(res.status).toBe(400);
    });

    it("rejects an invalid tag with 400", async () => {
      const res = await app.request(`/api/projects/${projectId}/ideas?tag=Not_Kebab`);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/ideas/:id", () => {
    it("returns a single idea with its body", async () => {
      const res = await app.request(`/api/ideas/${openIdeaId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        idea: { id: string; title: string; body: string; status: string };
      };
      expect(body.idea.id).toBe(openIdeaId);
      expect(body.idea.title).toBe("Plain open idea");
      expect(body.idea.body).toBe("the body");
      expect(body.idea.status).toBe("open");
    });

    it("decorates the single idea with its linkedPrds", async () => {
      const res = await app.request(`/api/ideas/${linkedSourceIdeaId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        idea: {
          id: string;
          linkedPrds: Array<{ revisionId: string; prdId: string; title: string }>;
        };
      };
      expect(body.idea.linkedPrds.map((p) => p.revisionId)).toEqual([prdRevisionId]);
      expect(body.idea.linkedPrds[0]!.title).toBe("PRD with source idea");
    });

    it("returns an empty linkedPrds array for an unlinked idea", async () => {
      const res = await app.request(`/api/ideas/${openIdeaId}`);
      const body = (await res.json()) as { idea: { linkedPrds: unknown[] } };
      expect(body.idea.linkedPrds).toEqual([]);
    });

    it("returns 404 for an unknown id", async () => {
      const res = await app.request(`/api/ideas/does-not-exist`);
      expect(res.status).toBe(404);
    });
  });

  describe("PRD detail surfacing of source ideas", () => {
    it("includes the linked source idea on GET /api/prds/:id (still open)", async () => {
      const res = await app.request(`/api/prds/${prdRevisionId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sourceIdeas: Array<{ id: string; title: string; body: string; status: string }>;
      };
      expect(body.sourceIdeas.map((i) => i.id)).toEqual([linkedSourceIdeaId]);
      expect(body.sourceIdeas[0]!.title).toBe("Motivating idea");
      expect(body.sourceIdeas[0]!.body).toBe("why we build");
      // Linking does not change status — referencing ≠ committing.
      expect(body.sourceIdeas[0]!.status).toBe("open");
    });

    it("auto-links the originating idea on a promoted PRD", async () => {
      const res = await app.request(`/api/prds/${promotedPrdRevisionId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sourceIdeas: Array<{ id: string; status: string }> };
      expect(body.sourceIdeas.map((i) => i.id)).toEqual([promotedIdeaId]);
      expect(body.sourceIdeas[0]!.status).toBe("promoted");
    });

    it("returns an empty sourceIdeas array for a PRD with no linked ideas", async () => {
      const standalone = (await run(createPrd({ projectId, title: "No source ideas" }))).id;
      const res = await app.request(`/api/prds/${standalone}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sourceIdeas: unknown[] };
      expect(body.sourceIdeas).toEqual([]);
    });
  });
});
