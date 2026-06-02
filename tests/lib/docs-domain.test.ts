import { describe, it, expect, beforeEach } from "vite-plus/test";
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
  extractTicket,
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
    expect(range.kind).toBe("resolved");
    if (range.kind !== "resolved") throw new Error("expected resolved");
    expect(range.sources[0]?.mode).toBe("expr");
    expect(range.sources[0]?.since).toBe("15 days ago");
  });

  it("resolveDiffRange passes --until through alongside --since", async () => {
    await run(
      createProfile({
        projectId,
        name: "until",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    const range = await run(
      resolveDiffRange({
        profileName: "until",
        projectId,
        sinceExpr: "abc123^",
        untilExpr: "abc123",
      }),
    );
    expect(range.kind).toBe("resolved");
    if (range.kind !== "resolved") throw new Error("expected resolved");
    expect(range.sources[0]?.mode).toBe("expr");
    expect(range.sources[0]?.since).toBe("abc123^");
    expect(range.sources[0]?.until).toBe("abc123");
  });

  it("resolveDiffRange refuses (no HEAD~20 fallback) when no sinceExpr and no strategy", async () => {
    await run(
      createProfile({
        projectId,
        name: "refuse",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    const promise = run(resolveDiffRange({ profileName: "refuse", projectId }));
    await expect(promise).rejects.toThrow(/cannot determine the feature's commit range/);
    await expect(promise).rejects.toThrow(/--since/);
    await expect(promise).rejects.not.toThrow(/HEAD~20/);
  });

  it("resolveDiffRange refuses when a pattern is set but no ticket/repo (no silent guess)", async () => {
    await run(
      createProfile({
        projectId,
        name: "no-ticket",
        targetRoot: "./docs",
        sources: [{ name: "core", path: "./" }],
      }),
    );
    // Pattern configured but ticket unresolved (e.g. PRD had no Refs): the
    // strategy does not engage and we still refuse rather than fall back.
    const promise = run(
      resolveDiffRange({
        profileName: "no-ticket",
        projectId,
        ticketPattern: "TICKET-\\d+",
        ticket: null,
        repo: { path: process.cwd(), baseBranch: "main" },
      }),
    );
    await expect(promise).rejects.toThrow(/cannot determine the feature's commit range/);
  });
});

describe("extractTicket (PRD 0023 / T2)", () => {
  it("prefers an explicit `Refs <ticket>` in the body", () => {
    const t = extractTicket(
      { title: "Some feature TICKET-9999", body: "Background.\n\nRefs TICKET-1234\n\nMore." },
      "TICKET-\\d+",
    );
    expect(t).toBe("TICKET-1234");
  });

  it("falls back to a bare match in the body when there is no Refs line", () => {
    const t = extractTicket(
      { title: "untitled", body: "This implements TICKET-1234 across repos." },
      "TICKET-\\d+",
    );
    expect(t).toBe("TICKET-1234");
  });

  it("falls back to the title when the body has no match", () => {
    const t = extractTicket(
      { title: "TICKET-1234 — multi-repo doc sync", body: "No ticket in the body." },
      "TICKET-\\d+",
    );
    expect(t).toBe("TICKET-1234");
  });

  it("returns null when nothing matches", () => {
    expect(extractTicket({ title: "no ticket here", body: "nor here" }, "TICKET-\\d+")).toBeNull();
  });

  it("never reads suggestedCommitMessage and tolerates a null body", () => {
    expect(extractTicket({ title: "TICKET-42 fix", body: null }, "TICKET-\\d+")).toBe("TICKET-42");
    expect(extractTicket({ title: "plain", body: undefined }, "TICKET-\\d+")).toBeNull();
  });

  it("treats an invalid pattern as no-match instead of throwing", () => {
    expect(extractTicket({ title: "TICKET-1", body: "x" }, "TICKET-(")).toBeNull();
  });
});
