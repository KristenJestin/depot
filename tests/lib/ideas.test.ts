import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { getPrd } from "#/modules/prds/domain";
import { listTagsForPrd } from "#/modules/prds/tags";
import {
  createIdea,
  dropIdea,
  getIdea,
  linkIdeaToPrd,
  listIdeaPrds,
  listIdeas,
  listPrdIdeas,
  promoteIdea,
  reopenIdea,
  unlinkIdeaFromPrd,
  updateIdea,
} from "#/modules/ideas/domain";
import type { Database } from "#/db/client";

/**
 * Domain coverage for the idea-capture subsystem (PRD 0027 / T1). Exercises
 * the invariants the SQL schema cannot express alone — title/tag/body
 * validation, the triage lifecycle transitions, the single `promote` bridge
 * into a draft PRD (tag carry-over + provenance + reference join), and the
 * idempotent same-project link/unlink helpers.
 */
describe("ideas domain (PRD 0027 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
  });

  // ── create + validation ──────────────────────────────────────────────────

  it("creates an open idea with title, body and tag", async () => {
    const idea = await run(
      createIdea({ projectId, title: "Plugin marketplace", body: "# notes", tag: "plugins" }),
    );
    expect(idea.title).toBe("Plugin marketplace");
    expect(idea.body).toBe("# notes");
    expect(idea.tag).toBe("plugins");
    expect(idea.status).toBe("open");
    expect(idea.promotedPrdId).toBeNull();
    expect(idea.droppedReason).toBeNull();
    expect(idea.projectId).toBe(projectId);
  });

  it("creates a minimal idea with just a title", async () => {
    const idea = await run(createIdea({ projectId, title: "Just a thought" }));
    expect(idea.title).toBe("Just a thought");
    expect(idea.body).toBeNull();
    expect(idea.tag).toBeNull();
    expect(idea.status).toBe("open");
  });

  it("rejects an empty title", async () => {
    await expect(run(createIdea({ projectId, title: "   " }))).rejects.toThrow(/title/);
    await expect(run(createIdea({ projectId, title: "" }))).rejects.toThrow(/title/);
  });

  it("rejects a title longer than 200 chars", async () => {
    await expect(run(createIdea({ projectId, title: "x".repeat(201) }))).rejects.toThrow(/200/);
  });

  it("rejects a non-kebab tag", async () => {
    await expect(run(createIdea({ projectId, title: "t", tag: "Bad Tag" }))).rejects.toThrow(
      /kebab-case/,
    );
    await expect(run(createIdea({ projectId, title: "t", tag: "-leading" }))).rejects.toThrow(
      /kebab-case/,
    );
  });

  it("rejects an oversized body (> 100 KB)", async () => {
    const big = "x".repeat(100 * 1024 + 1);
    await expect(run(createIdea({ projectId, title: "t", body: big }))).rejects.toThrow(/body/);
  });

  // ── list filters + ordering ──────────────────────────────────────────────

  it("lists open ideas by default, newest-first", async () => {
    const a = await run(createIdea({ projectId, title: "first" }));
    const b = await run(createIdea({ projectId, title: "second" }));
    const c = await run(createIdea({ projectId, title: "third" }));
    const open = await run(listIdeas(projectId));
    expect(open.map((i) => i.id)).toEqual([c.id, b.id, a.id]);
  });

  it("filters by status", async () => {
    const a = await run(createIdea({ projectId, title: "keep" }));
    const b = await run(createIdea({ projectId, title: "kill" }));
    await run(dropIdea(b.id));

    const open = await run(listIdeas(projectId, { status: "open" }));
    expect(open.map((i) => i.id)).toEqual([a.id]);
    const dropped = await run(listIdeas(projectId, { status: "dropped" }));
    expect(dropped.map((i) => i.id)).toEqual([b.id]);
  });

  it("filters by tag", async () => {
    const a = await run(createIdea({ projectId, title: "a", tag: "plugins" }));
    await run(createIdea({ projectId, title: "b", tag: "billing" }));
    const tagged = await run(listIdeas(projectId, { tag: "plugins" }));
    expect(tagged.map((i) => i.id)).toEqual([a.id]);
  });

  // ── getIdea + updateIdea ──────────────────────────────────────────────────

  it("getIdea returns the row and fails for an unknown id", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    const fetched = await run(getIdea(idea.id));
    expect(fetched.id).toBe(idea.id);
    await expect(run(getIdea("does-not-exist"))).rejects.toThrow(/Idea not found/);
  });

  it("updateIdea changes title/body/tag in place", async () => {
    const idea = await run(createIdea({ projectId, title: "old", tag: "plugins" }));
    const updated = await run(
      updateIdea(idea.id, { title: "new", body: "body now", tag: "billing" }),
    );
    expect(updated.title).toBe("new");
    expect(updated.body).toBe("body now");
    expect(updated.tag).toBe("billing");
  });

  it("updateIdea rejects a bad tag and an oversized body", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    await expect(run(updateIdea(idea.id, { tag: "Bad Tag" }))).rejects.toThrow(/kebab-case/);
    await expect(run(updateIdea(idea.id, { body: "x".repeat(100 * 1024 + 1) }))).rejects.toThrow(
      /body/,
    );
  });

  // ── transitions ───────────────────────────────────────────────────────────

  it("drops an open idea and stores the reason", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    const dropped = await run(dropIdea(idea.id, { reason: "not relevant" }));
    expect(dropped.status).toBe("dropped");
    expect(dropped.droppedReason).toBe("not relevant");
  });

  it("drops without a reason", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    const dropped = await run(dropIdea(idea.id));
    expect(dropped.status).toBe("dropped");
    expect(dropped.droppedReason).toBeNull();
  });

  it("reopens a dropped idea", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    await run(dropIdea(idea.id));
    const reopened = await run(reopenIdea(idea.id));
    expect(reopened.status).toBe("open");
  });

  it("refuses to drop a non-open idea", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    await run(dropIdea(idea.id));
    await expect(run(dropIdea(idea.id))).rejects.toThrow(/transition/);
  });

  it("refuses to reopen an open idea", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    await expect(run(reopenIdea(idea.id))).rejects.toThrow(/transition/);
  });

  // ── promote ─────────────────────────────────────────────────────────────

  it("promoteIdea creates a draft PRD, sets promotedPrdId, carries the tag, and links", async () => {
    const idea = await run(
      createIdea({ projectId, title: "Plugin marketplace", body: "raw need", tag: "plugins" }),
    );
    const { idea: promoted, prd } = await run(promoteIdea(idea.id));

    expect(prd.status).toBe("draft");
    expect(prd.title).toBe("Plugin marketplace");
    expect(prd.context).toBe("raw need");
    expect(prd.projectId).toBe(projectId);

    expect(promoted.status).toBe("promoted");
    // promotedPrdId points at the LOGICAL prd, not the revision.
    expect(promoted.promotedPrdId).toBe(prd.prdId);

    // Tag carried over onto the new PRD.
    const tags = await run(listTagsForPrd(prd.id));
    expect(tags).toEqual(["plugins"]);

    // Reference join inserted (logical prd ↔ idea).
    const linkedIdeas = await run(listPrdIdeas(prd.prdId));
    expect(linkedIdeas.map((i) => i.id)).toEqual([idea.id]);
    const linkedPrds = await run(listIdeaPrds(idea.id));
    expect(linkedPrds.map((p) => p.prdId)).toEqual([prd.prdId]);
  });

  it("promoteIdea honours a title override and leaves context from the body", async () => {
    const idea = await run(createIdea({ projectId, title: "rough", body: "ctx" }));
    const { prd } = await run(promoteIdea(idea.id, { title: "Polished title" }));
    expect(prd.title).toBe("Polished title");
    expect(prd.context).toBe("ctx");
  });

  it("promoteIdea without a tag does not attach any PRD tag", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    const { prd } = await run(promoteIdea(idea.id));
    const tags = await run(listTagsForPrd(prd.id));
    expect(tags).toEqual([]);
  });

  it("refuses to promote a non-open idea", async () => {
    const idea = await run(createIdea({ projectId, title: "t" }));
    await run(dropIdea(idea.id));
    await expect(run(promoteIdea(idea.id))).rejects.toThrow(/not open/i);

    const open = await run(createIdea({ projectId, title: "u" }));
    await run(promoteIdea(open.id));
    await expect(run(promoteIdea(open.id))).rejects.toThrow(/not open/i);
  });

  // ── link / unlink ─────────────────────────────────────────────────────────

  it("linkIdeaToPrd is idempotent and does not change idea status", async () => {
    const idea = await run(createIdea({ projectId, title: "src" }));
    const prd = await run(getPrd((await runCreatePrd(run, projectId)).id));
    if (!prd) throw new Error("prd missing");

    await run(linkIdeaToPrd(prd.prdId, idea.id));
    await run(linkIdeaToPrd(prd.prdId, idea.id)); // idempotent — no throw, no dup
    const linked = await run(listPrdIdeas(prd.prdId));
    expect(linked.map((i) => i.id)).toEqual([idea.id]);

    const after = await run(getIdea(idea.id));
    expect(after.status).toBe("open");
  });

  it("unlinkIdeaFromPrd is idempotent", async () => {
    const idea = await run(createIdea({ projectId, title: "src" }));
    const rev = await runCreatePrd(run, projectId);
    await run(linkIdeaToPrd(rev.prdId, idea.id));
    await run(unlinkIdeaFromPrd(rev.prdId, idea.id));
    await run(unlinkIdeaFromPrd(rev.prdId, idea.id)); // no-op, no throw
    const linked = await run(listPrdIdeas(rev.prdId));
    expect(linked).toHaveLength(0);

    const after = await run(getIdea(idea.id));
    expect(after.status).toBe("open");
  });

  it("refuses to link an idea and a PRD from different projects", async () => {
    const otherProject = (await run(createProject({ name: "other" }))).id;
    const idea = await run(createIdea({ projectId, title: "src" }));
    const otherRev = await runCreatePrd(run, otherProject);
    await expect(run(linkIdeaToPrd(otherRev.prdId, idea.id))).rejects.toThrow(/project/i);
  });

  it("refuses to link a missing idea or a missing PRD", async () => {
    const idea = await run(createIdea({ projectId, title: "src" }));
    const rev = await runCreatePrd(run, projectId);
    await expect(run(linkIdeaToPrd(rev.prdId, "missing-idea"))).rejects.toThrow(/Idea not found/);
    await expect(run(linkIdeaToPrd("missing-prd", idea.id))).rejects.toThrow(/PRD not found/);
  });
});

/** Helper: create a PRD and return its revision row (logical id is `.prdId`). */
async function runCreatePrd(run: ReturnType<typeof makeRun>, projectId: string) {
  const { createPrd } = await import("#/modules/prds/domain");
  return run(createPrd({ projectId, title: "linked-prd" }));
}
