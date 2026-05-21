import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, makeRun } from "../helpers/db";
import {
  registerDocArtifact,
  nextAdrNumber,
  supersedeAdr,
  listDocArtifacts,
  touchDocArtifact,
  linkDocToPrd,
} from "#/modules/docs/domain";
import {
  createProfile,
  updateProfile,
  getProfile,
  listProfiles,
  deleteProfile,
  recordSyncRun,
  listSyncRuns,
  resolveDiffRange,
} from "#/modules/docs/sync";
import { createPrd } from "#/modules/prds/domain";
import { createProject } from "#/modules/projects/domain";
import type { Database } from "#/db/client";

describe("doc artifacts", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  it("returns 1 as the first ADR number on a fresh project", async () => {
    const n = await run(nextAdrNumber(projectId));
    expect(n).toBe(1);
  });

  it("monotonically increments the ADR number", async () => {
    await run(
      registerDocArtifact({
        projectId,
        kind: "adr",
        path: "docs/adr/0001-foo.md",
        title: "Foo",
        number: 1,
      }),
    );
    await run(
      registerDocArtifact({
        projectId,
        kind: "adr",
        path: "docs/adr/0002-bar.md",
        title: "Bar",
        number: 2,
      }),
    );
    const n = await run(nextAdrNumber(projectId));
    expect(n).toBe(3);
  });

  it("supersedes an ADR and chains the relation", async () => {
    await run(
      registerDocArtifact({
        projectId,
        kind: "adr",
        path: "docs/adr/0001-foo.md",
        title: "Foo",
        number: 1,
        status: "accepted",
      }),
    );
    await run(
      registerDocArtifact({
        projectId,
        kind: "adr",
        path: "docs/adr/0002-foo-v2.md",
        title: "Foo v2",
        number: 2,
        status: "accepted",
      }),
    );
    const old = await run(supersedeAdr(projectId, 1, 2));
    expect(old.status).toBe("superseded");
    expect(old.supersededBy).toBeTruthy();
  });

  it("touches the artifact and bumps lastModifiedAt", async () => {
    const item = await run(
      registerDocArtifact({
        projectId,
        kind: "context",
        path: "docs/CONTEXT.md",
        title: "CONTEXT",
      }),
    );
    const initial = item.lastModifiedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const touched = await run(touchDocArtifact(item.id, "human"));
    expect(touched.lastModifiedAt.getTime()).toBeGreaterThan(initial);
    expect(touched.lastModifiedBySource).toBe("human");
  });

  it("links a doc to a PRD", async () => {
    const prd = await run(createPrd({ projectId, title: "PRD" }));
    const item = await run(
      registerDocArtifact({
        projectId,
        kind: "adr",
        path: "docs/adr/0001-foo.md",
        title: "Foo",
        number: 1,
      }),
    );
    const linked = await run(linkDocToPrd(item.id, prd.id));
    expect(linked.linkedPrdRevisionId).toBe(prd.id);
  });

  it("filters listDocArtifacts by kind", async () => {
    await run(
      registerDocArtifact({
        projectId,
        kind: "adr",
        path: "a.md",
        title: "A",
        number: 1,
      }),
    );
    await run(
      registerDocArtifact({
        projectId,
        kind: "context",
        path: "b.md",
        title: "B",
      }),
    );
    const adrs = await run(listDocArtifacts(projectId, { kind: "adr" }));
    expect(adrs).toHaveLength(1);
    expect(adrs[0]?.title).toBe("A");
  });
});

describe("doc profiles + sync", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const project = await run(createProject({ name: "test" }));
    projectId = project.id;
  });

  it("creates, updates, lists, deletes profiles", async () => {
    await run(createProfile({ projectId, name: "public-docs", targetRoot: "./docs" }));
    let profile = await run(getProfile(projectId, "public-docs"));
    expect(profile?.style).toBe("mixed");
    await run(
      updateProfile(projectId, "public-docs", {
        style: "reference",
        guardrails: ["no-secrets"],
      }),
    );
    profile = await run(getProfile(projectId, "public-docs"));
    expect(profile?.style).toBe("reference");
    expect(profile?.guardrails).toBe(JSON.stringify(["no-secrets"]));
    const list = await run(listProfiles(projectId));
    expect(list).toHaveLength(1);
    await run(deleteProfile(projectId, "public-docs"));
    expect(await run(listProfiles(projectId))).toHaveLength(0);
  });

  it("refuses to create a duplicate profile name", async () => {
    await run(createProfile({ projectId, name: "x", targetRoot: "./docs" }));
    await expect(
      run(createProfile({ projectId, name: "x", targetRoot: "./docs" })),
    ).rejects.toThrow(/already exists/);
  });

  it("records sync runs and lists them", async () => {
    const profile = await run(createProfile({ projectId, name: "p", targetRoot: "./docs" }));
    await run(recordSyncRun({ profileId: profile.id, sinceRef: "abc" }));
    await run(recordSyncRun({ profileId: profile.id, sinceRef: "def" }));
    const runs = await run(listSyncRuns(profile.id));
    expect(runs).toHaveLength(2);
  });

  it("resolveDiffRange uses sinceExpr when provided", async () => {
    await run(
      createProfile({
        projectId,
        name: "p",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    const range = await run(
      resolveDiffRange({ profileName: "p", projectId, sinceExpr: "15 days ago" }),
    );
    expect(range.sources[0]?.mode).toBe("expr");
    expect(range.sources[0]?.since).toBe("15 days ago");
  });

  it("resolveDiffRange uses PRD SHAs when prdRevisionId is supplied", async () => {
    const prd = await run(createPrd({ projectId, title: "P" }));
    // Direct DB poke to simulate an activated PRD with a SHA captured.
    const { prdRevisions } = await import("#/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(prdRevisions)
      .set({ activatedAtSha: "deadbeef", doneAtSha: "feedbeef" })
      .where(eq(prdRevisions.id, prd.id))
      .run();

    await run(
      createProfile({
        projectId,
        name: "p",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    const range = await run(
      resolveDiffRange({ profileName: "p", projectId, prdRevisionId: prd.id }),
    );
    expect(range.sources[0]?.mode).toBe("sha");
    expect(range.sources[0]?.since).toBe("deadbeef");
    expect(range.sources[0]?.until).toBe("feedbeef");
  });

  it("resolveDiffRange falls back to mergedAtSha when only a squash merge was captured", async () => {
    const prd = await run(createPrd({ projectId, title: "Squashed PRD" }));
    const { prdRevisions } = await import("#/db/schema");
    const { eq } = await import("drizzle-orm");
    // No activatedAtSha — the PRD was merged (squash) without depot activation.
    db.update(prdRevisions)
      .set({ mergedAtSha: "5qua5hed" })
      .where(eq(prdRevisions.id, prd.id))
      .run();

    await run(
      createProfile({
        projectId,
        name: "squash-doc",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    const range = await run(
      resolveDiffRange({ profileName: "squash-doc", projectId, prdRevisionId: prd.id }),
    );
    expect(range.sources[0]?.mode).toBe("sha");
    expect(range.sources[0]?.since).toBe("5qua5hed^");
    expect(range.sources[0]?.until).toBe("5qua5hed");
  });

  it("resolveDiffRange anchors until on mergedAtSha when doneAtSha is unset", async () => {
    const prd = await run(createPrd({ projectId, title: "Activated + squashed PRD" }));
    const { prdRevisions } = await import("#/db/schema");
    const { eq } = await import("drizzle-orm");
    // Activated then squash-merged: activatedAtSha known, doneAtSha never
    // captured — until falls back to the squash commit.
    db.update(prdRevisions)
      .set({ activatedAtSha: "ac71va7e", mergedAtSha: "5qua5hed" })
      .where(eq(prdRevisions.id, prd.id))
      .run();

    await run(
      createProfile({
        projectId,
        name: "merge-anchor-doc",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    const range = await run(
      resolveDiffRange({ profileName: "merge-anchor-doc", projectId, prdRevisionId: prd.id }),
    );
    expect(range.sources[0]?.since).toBe("ac71va7e");
    expect(range.sources[0]?.until).toBe("5qua5hed");
  });
});
