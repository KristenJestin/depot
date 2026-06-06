import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd } from "#/modules/prds/domain";
import { createTask } from "#/modules/tasks/domain";
import {
  addPage,
  addVariant,
  addVersion,
  clearElection,
  createPrototype,
  createRound,
  distillPagePlacement,
  dropPage,
  electVariant,
  evaluateDesignReadiness,
  forkPrototypes,
  getCurrentRound,
  getRound,
  getRoundPagePlacement,
  includePage,
  listPrototypes,
  listRoundPages,
  listRounds,
  listVersions,
  loadPrototypeTree,
  pinPage,
  removePage,
  resolveVariant,
} from "#/modules/prds/prototypes";
import { taskPrototypePages } from "#/db/schema";
import type { Database } from "#/db/client";

/**
 * Rounds domain (PRD 0029 / Tranche A). A round is a whole-design round —
 * a named, manifest-pinned snapshot of which page version ships together —
 * distinct from a per-page `version` iteration. Membership is row presence in
 * the manifest; the latest round (max `position`) is the mutable "current"
 * one, earlier rounds are frozen by construction.
 */
describe("prototype rounds domain (PRD 0029 / A)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  async function seedPageWithVersion(prototypeId: string, pageSlug = "home") {
    const page = await run(addPage({ prototypeId, slug: pageSlug, title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    return { page, v1 };
  }

  it("createPrototype auto-creates an empty 'v1' round", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const rounds = await run(listRounds(proto.id));
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.label).toBe("v1");
    expect(rounds[0]!.position).toBe(0);
    const manifest = await run(listRoundPages(rounds[0]!.id));
    expect(manifest).toHaveLength(0);
  });

  it("createRound increments position; getCurrentRound returns the latest", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const v1 = (await run(listRounds(proto.id)))[0]!;
    expect(v1.position).toBe(0);

    const v2 = await run(createRound({ prototypeId: proto.id, label: "v2" }));
    expect(v2.position).toBe(1);
    const v3 = await run(createRound({ prototypeId: proto.id, label: "v3" }));
    expect(v3.position).toBe(2);

    const rounds = await run(listRounds(proto.id));
    expect(rounds.map((r) => r.label)).toEqual(["v1", "v2", "v3"]);

    const current = await run(getCurrentRound(proto.id));
    expect(current?.id).toBe(v3.id);
  });

  it("getCurrentRound returns null when the prototype has no round", async () => {
    // A prototype always has a round via createPrototype, so synthesise the
    // empty case against an id that never had a round.
    const current = await run(getCurrentRound("unknown-prototype"));
    expect(current).toBeNull();
  });

  it("refuses a duplicate round label on the same prototype", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await expect(run(createRound({ prototypeId: proto.id, label: "v1" }))).rejects.toThrow(
      /already exists/,
    );
  });

  it("rejects an invalid round label", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await expect(run(createRound({ prototypeId: proto.id, label: "Bad Label" }))).rejects.toThrow(
      /kebab-case/,
    );
  });

  it("includePage adds an entry pinning the given version; re-include is idempotent", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const round = (await run(listRounds(proto.id)))[0]!;
    const { page, v1 } = await seedPageWithVersion(proto.id);
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));

    const row = await run(includePage(round.id, page.id, v1.id));
    expect(row.pageId).toBe(page.id);
    expect(row.pageVersionId).toBe(v1.id);

    let manifest = await run(listRoundPages(round.id));
    expect(manifest).toHaveLength(1);

    const again = await run(includePage(round.id, page.id, v2.id));
    expect(again.id).toBe(row.id);
    expect(again.pageVersionId).toBe(v2.id);

    manifest = await run(listRoundPages(round.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageVersionId).toBe(v2.id);
  });

  it("includePage without a version pins the latest active version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const round = (await run(listRounds(proto.id)))[0]!;
    const { page, v1 } = await seedPageWithVersion(proto.id);
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));

    const row = await run(includePage(round.id, page.id));
    expect(row.pageVersionId).toBe(v2.id);
    expect(v1).toBeDefined();
  });

  it("includePage fails when the page has no active version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const round = (await run(listRounds(proto.id)))[0]!;
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await expect(run(includePage(round.id, page.id))).rejects.toThrow(/version not found/);
  });

  it("includePage rejects an explicit version from another page", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const round = (await run(listRounds(proto.id)))[0]!;
    const home = await seedPageWithVersion(proto.id, "home");
    const settings = await seedPageWithVersion(proto.id, "settings");

    await expect(run(includePage(round.id, home.page.id, settings.v1.id))).rejects.toThrow(
      /does not belong to page/,
    );
  });

  it("pinPage advances the pin; pinning another page's version is rejected", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const round = (await run(listRounds(proto.id)))[0]!;
    const { page, v1 } = await seedPageWithVersion(proto.id, "home");
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    await run(includePage(round.id, page.id, v1.id));

    const pinned = await run(pinPage(round.id, page.id, v2.id));
    expect(pinned.pageVersionId).toBe(v2.id);

    const other = await seedPageWithVersion(proto.id, "settings");
    await expect(run(pinPage(round.id, page.id, other.v1.id))).rejects.toThrow(/does not belong/);
  });

  it("dropPage removes the entry and is a no-op when absent", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const round = (await run(listRounds(proto.id)))[0]!;
    const { page, v1 } = await seedPageWithVersion(proto.id);
    await run(includePage(round.id, page.id, v1.id));
    expect(await run(listRoundPages(round.id))).toHaveLength(1);

    await run(dropPage(round.id, page.id));
    expect(await run(listRoundPages(round.id))).toHaveLength(0);

    // No-op when already absent.
    await run(dropPage(round.id, page.id));
    expect(await run(listRoundPages(round.id))).toHaveLength(0);
  });

  it("createRound({ fromRoundId }) clones the manifest without creating page versions", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const source = (await run(listRounds(proto.id)))[0]!;
    const home = await seedPageWithVersion(proto.id, "home");
    const settings = await seedPageWithVersion(proto.id, "settings");
    await run(includePage(source.id, home.page.id, home.v1.id));
    await run(includePage(source.id, settings.page.id, settings.v1.id));

    const before =
      (await run(listVersions(home.page.id))).length +
      (await run(listVersions(settings.page.id))).length;

    const v2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: source.id }),
    );
    const cloned = await run(listRoundPages(v2.id));
    expect(cloned).toHaveLength(2);
    const pins = new Map(cloned.map((r) => [r.pageId, r.pageVersionId]));
    expect(pins.get(home.page.id)).toBe(home.v1.id);
    expect(pins.get(settings.page.id)).toBe(settings.v1.id);

    const after =
      (await run(listVersions(home.page.id))).length +
      (await run(listVersions(settings.page.id))).length;
    expect(after).toBe(before);
  });

  it("dropping a page on a cloned round leaves the source manifest intact", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const source = (await run(listRounds(proto.id)))[0]!;
    const { page, v1 } = await seedPageWithVersion(proto.id);
    await run(includePage(source.id, page.id, v1.id));

    const v2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: source.id }),
    );
    await run(dropPage(v2.id, page.id));

    expect(await run(listRoundPages(v2.id))).toHaveLength(0);
    expect(await run(listRoundPages(source.id))).toHaveLength(1);
  });

  it("getRound on an unknown id raises PrototypeRoundNotFoundError", async () => {
    await expect(run(getRound("nope"))).rejects.toThrow(/round not found/i);
  });
});

/**
 * Round-relative resolution (PRD 0029 / Tranche B). `resolveVariant` resolves
 * a page link against a round's manifest pin — the current round by default,
 * or an explicit one. `addVersion` keeps the current round tracking the page,
 * and `forkPrototypes` carries rounds + manifest (pins remapped) into the fork.
 */
describe("prototype round-relative resolution (PRD 0029 / B)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  async function seedHomeWithMainVariant(prototypeId: string, label = "v1") {
    const page = await run(addPage({ prototypeId, slug: "home", title: "Home" }));
    const version = await run(addVersion({ pageId: page.id, label }));
    const variant = await run(
      addVariant({
        pageVersionId: version.id,
        label: "rail",
        title: `Rail ${label}`,
        htmlContent: "<p/>",
      }),
    );
    return { page, version, variant };
  }

  it("default resolution uses the current round's pin and follows auto-advance", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, version: v1, variant: v1Rail } = await seedHomeWithMainVariant(proto.id);

    // First addVersion auto-included the page into the current round pinned at v1.
    const current = (await run(getCurrentRound(proto.id)))!;
    const manifest = await run(listRoundPages(current.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageVersionId).toBe(v1.id);

    let resolved = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.version.id).toBe(v1.id);
    expect(resolved.variant.id).toBe(v1Rail.id);

    // A new version auto-advances the current pin; default resolution follows it.
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    const v2Rail = await run(
      addVariant({ pageVersionId: v2.id, label: "rail", title: "Rail v2", htmlContent: "<p/>" }),
    );
    resolved = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.version.id).toBe(v2.id);
    expect(resolved.variant.id).toBe(v2Rail.id);
  });

  it("explicit roundId resolves against that round's pin (no HTML duplication)", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, version: v1, variant: v1Rail } = await seedHomeWithMainVariant(proto.id);
    // roundV1 (the auto-created current round) was auto-pinned to v1 by addVersion.
    const roundV1 = (await run(getCurrentRound(proto.id)))!;

    // Open a second round first so it — not roundV1 — is the one addVersion
    // would auto-advance. roundV1 stays frozen at v1.
    const roundV2 = await run(createRound({ prototypeId: proto.id, label: "rel-v2" }));
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    const v2Rail = await run(
      addVariant({ pageVersionId: v2.id, label: "rail", title: "Rail v2", htmlContent: "<p/>" }),
    );
    // roundV2 had an empty manifest and the page already had a version, so
    // addVersion left it untouched; pin v2 into it explicitly.
    await run(pinPage(roundV2.id, page.id, v2.id));

    const inV1 = await run(
      resolveVariant({
        prototypeId: proto.id,
        pageSlug: "home",
        variantLabel: null,
        roundId: roundV1.id,
      }),
    );
    const inV2 = await run(
      resolveVariant({
        prototypeId: proto.id,
        pageSlug: "home",
        variantLabel: null,
        roundId: roundV2.id,
      }),
    );
    if (inV1.kind !== "resolved" || inV2.kind !== "resolved") throw new Error("expected resolved");
    expect(inV1.version.id).toBe(v1.id);
    expect(inV1.variant.id).toBe(v1Rail.id);
    expect(inV2.version.id).toBe(v2.id);
    expect(inV2.variant.id).toBe(v2Rail.id);
    // Both pins live on the same page timeline — no HTML was duplicated.
    expect(inV1.page.id).toBe(page.id);
    expect(inV2.page.id).toBe(page.id);
  });

  it("a page dropped from the current round resolves as dropped, still resolvable earlier", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, variant } = await seedHomeWithMainVariant(proto.id);
    const roundV1 = (await run(getCurrentRound(proto.id)))!;

    // Snapshot v1's manifest into a new current round, then drop the page there.
    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "rel-v2", fromRoundId: roundV1.id }),
    );
    await run(dropPage(roundV2.id, page.id));

    const dropped = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    expect(dropped.kind).toBe("dropped");
    if (dropped.kind !== "dropped") throw new Error("expected dropped");
    expect(dropped.page.id).toBe(page.id);

    // The earlier round still ships the page.
    const stillThere = await run(
      resolveVariant({
        prototypeId: proto.id,
        pageSlug: "home",
        variantLabel: null,
        roundId: roundV1.id,
      }),
    );
    if (stillThere.kind !== "resolved") throw new Error("expected resolved");
    expect(stillThere.variant.id).toBe(variant.id);
  });

  it("a broken page-slug link is still an error, not a dropped outcome", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await seedHomeWithMainVariant(proto.id);
    await expect(
      run(resolveVariant({ prototypeId: proto.id, pageSlug: "ghost", variantLabel: null })),
    ).rejects.toThrow(/no page with slug/);
  });

  it("addVersion auto-includes a brand-new page, advances on the next version, respects a drop", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const current = (await run(getCurrentRound(proto.id)))!;

    // First version of a new page → auto-included, pinned to it.
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    let manifest = await run(listRoundPages(current.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageVersionId).toBe(v1.id);

    // Next version → pin advanced in place (still one entry).
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    manifest = await run(listRoundPages(current.id));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.pageVersionId).toBe(v2.id);

    // Drop the page, then add a further version → it stays out (drop respected).
    await run(dropPage(current.id, page.id));
    await run(addVersion({ pageId: page.id, label: "v3" }));
    manifest = await run(listRoundPages(current.id));
    expect(manifest).toHaveLength(0);
  });

  it("forkPrototypes carries rounds + manifest, pins remapped to the fork's versions", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedHomeWithMainVariant(proto.id);
    const roundV1 = (await run(getCurrentRound(proto.id)))!;
    // A second round frozen at v1, then advance the current round to v2.
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    await run(
      addVariant({ pageVersionId: v2.id, label: "rail", title: "Rail v2", htmlContent: "<p/>" }),
    );

    const otherRev = (await run(createPrd({ projectId, title: "Y" }))).id;
    await run(forkPrototypes(prdRevisionId, otherRev));

    const forked = (await run(listPrototypes(otherRev)))[0]!;
    expect(forked.id).not.toBe(proto.id);

    // Same set of rounds, no parasitic extra v1.
    const forkedRounds = await run(listRounds(forked.id));
    const sourceRounds = await run(listRounds(proto.id));
    expect(forkedRounds.map((r) => r.label)).toEqual(sourceRounds.map((r) => r.label));

    // The fork's current round pins the fork's own v2 row, not the source's.
    const forkedCurrent = (await run(getCurrentRound(forked.id)))!;
    const forkedManifest = await run(listRoundPages(forkedCurrent.id));
    expect(forkedManifest).toHaveLength(1);
    expect(forkedManifest[0]!.pageVersionId).not.toBe(v2.id);

    // Resolving in the fork yields the fork's own v2 main variant.
    const resolved = await run(
      resolveVariant({ prototypeId: forked.id, pageSlug: "home", variantLabel: null }),
    );
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.version.label).toBe("v2");
    expect(resolved.variant.label).toBe("rail");
    expect(roundV1).toBeDefined();
  });
});

/**
 * Design-readiness gate scoped to the current round (PRD 0029 / Tranche C),
 * refined for the mono-variant case (PRD 0028). `evaluateDesignReadiness` only
 * evaluates the pages the current round still ships: a page dropped from the
 * current round stops blocking `prd ready`. A page present in the manifest
 * blocks only when it offers a genuine, undecided choice — **≥ 2 variants on the
 * pinned version and no election**. A single-variant page is retained by default
 * and never blocks.
 */
describe("design readiness scoped to the current round (PRD 0029 / C)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  async function seedPageWithVariant(prototypeId: string, pageSlug: string) {
    const page = await run(addPage({ prototypeId, slug: pageSlug, title: pageSlug }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({
        pageVersionId: version.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    return { page, version };
  }

  async function seedPageWithTwoVariants(prototypeId: string, pageSlug: string) {
    const { page, version } = await seedPageWithVariant(prototypeId, pageSlug);
    await run(
      addVariant({
        pageVersionId: version.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
      }),
    );
    return { page, version };
  }

  it("a page with ≥ 2 variants but no election present in the current round blocks ready", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await seedPageWithTwoVariants(proto.id, "home");

    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/page 'home' has 2 variant\(s\) but no elected design/);
  });

  it("a single-variant page is retained by default but must be distilled (mono-variant)", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await seedPageWithVariant(proto.id, "home");

    // Retained by default (no "no elected design" reason), but decided ⇒ it now
    // needs a per-page placement in the current round (PRD 0030 / issue 02).
    let r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.reasons.join(" ")).not.toMatch(/no elected design/);
    expect(r.reasons.join(" ")).toMatch(/page 'home' is decided but has no distilled placement/);

    // Distilling its placement clears the gate.
    const current = (await run(getCurrentRound(proto.id)))!;
    const page = (await run(listRoundPages(current.id)))[0]!;
    await run(
      distillPagePlacement(current.id, page.pageId, {
        placementSpec: "## Regions\nHeader, body.\n\n## Order\nHeader then body.",
      }),
    );
    r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(false);
  });

  it("a page dropped from the current round no longer blocks ready", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPageWithTwoVariants(proto.id, "home");
    const current = (await run(getCurrentRound(proto.id)))!;

    // The page was auto-included on its first version; dropping it from the
    // current round takes it out of this design round, so it stops blocking.
    await run(dropPage(current.id, page.id));

    const r = await run(evaluateDesignReadiness(prdRevisionId));
    // No reason mentioning the dropped page, and nothing else ships → unblocked.
    expect(r.reasons.join(" ")).not.toMatch(/home/);
    expect(r.blocked).toBe(false);
  });

  it("only manifest pages block: a dropped page is exempt while a kept one still blocks", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const dropped = await seedPageWithTwoVariants(proto.id, "dropped");
    await seedPageWithTwoVariants(proto.id, "kept");
    const current = (await run(getCurrentRound(proto.id)))!;

    await run(dropPage(current.id, dropped.page.id));

    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(true);
    const joined = r.reasons.join(" ");
    expect(joined).not.toMatch(/page 'dropped'/);
    expect(joined).toMatch(/page 'kept' has 2 variant\(s\) but no elected design/);
  });

  it("a PRD with no prototype stays unblocked (anti-regression)", async () => {
    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });
});

/**
 * View model exposure (PRD 0029 / Tranche E). `loadPrototypeTree` additively
 * surfaces the rounds and their manifests so web view models can render the
 * design rounds without re-querying. The shape is rounds-by-position, each
 * carrying its manifest entries.
 */
describe("loadPrototypeTree exposes rounds (PRD 0029 / E)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  it("returns the current round and its manifest, page count tracking include/drop", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));

    // A fresh prototype carries exactly its auto-created 'v1' round, empty.
    let tree = await run(loadPrototypeTree(proto.id));
    expect(tree.rounds).toHaveLength(1);
    expect(tree.rounds[0]!.round.label).toBe("v1");
    expect(tree.rounds[0]!.pages).toHaveLength(0);

    // Seeding a page's first version auto-includes it in the current round.
    const home = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await run(addVersion({ pageId: home.id, label: "v1" }));
    const settings = await run(
      addPage({ prototypeId: proto.id, slug: "settings", title: "Settings" }),
    );
    await run(addVersion({ pageId: settings.id, label: "v1" }));

    const current = (await run(getCurrentRound(proto.id)))!;

    tree = await run(loadPrototypeTree(proto.id));
    const currentEntry = tree.rounds.find((r) => r.round.id === current.id)!;
    expect(currentEntry.pages).toHaveLength(2);
    expect(currentEntry.pages.map((p) => p.pageId).sort()).toEqual([home.id, settings.id].sort());

    // Dropping a page from the current round shrinks the exposed manifest.
    await run(dropPage(current.id, settings.id));
    tree = await run(loadPrototypeTree(proto.id));
    const afterDrop = tree.rounds.find((r) => r.round.id === current.id)!;
    expect(afterDrop.pages).toHaveLength(1);
    expect(afterDrop.pages[0]!.pageId).toBe(home.id);

    // The additive change preserves the existing fields.
    expect(tree.prototype.id).toBe(proto.id);
    expect(Array.isArray(tree.pages)).toBe(true);
  });

  it("orders rounds by position and exposes multiple rounds", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const home = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await run(addVersion({ pageId: home.id, label: "v1" }));

    const v1 = (await run(getCurrentRound(proto.id)))!;
    const v2 = await run(createRound({ prototypeId: proto.id, label: "v2", fromRoundId: v1.id }));

    const tree = await run(loadPrototypeTree(proto.id));
    expect(tree.rounds.map((r) => r.round.label)).toEqual(["v1", "v2"]);
    // The cloned v2 manifest inherited v1's single pin.
    const v2Entry = tree.rounds.find((r) => r.round.id === v2.id)!;
    expect(v2Entry.pages).toHaveLength(1);
  });
});

/**
 * Round-scoped election (PRD 0030 / issue 01). The election (chosen variant +
 * arbitration record) lives on the `(round, page)` manifest row, not the page,
 * so each round carries its OWN decision. Cloning a round inherits the election;
 * advancing a page's pinned version resets it; electing in one round never
 * touches another.
 */
describe("round-scoped election (PRD 0030 / 01)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  async function seedPageWithTwoVariants(prototypeId: string, pageSlug = "home") {
    const page = await run(addPage({ prototypeId, slug: pageSlug, title: pageSlug }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    const rail = await run(
      addVariant({ pageVersionId: version.id, label: "rail", title: "Rail", htmlContent: "<p/>" }),
    );
    const tabs = await run(
      addVariant({ pageVersionId: version.id, label: "tabs", title: "Tabs", htmlContent: "<p/>" }),
    );
    return { page, version, rail, tabs };
  }

  it("electVariant records the election on the (round, page) manifest row, not the page", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;

    const election = await run(
      electVariant(tabs.id, { rationale: "clearest hierarchy", decidedBy: "direction" }),
    );
    expect(election.roundId).toBe(current.id);
    expect(election.pageId).toBe(page.id);
    expect(election.chosenVariantId).toBe(tabs.id);
    expect(election.decisionRationale).toBe("clearest hierarchy");
    expect(election.decidedBy).toBe("direction");
    expect(election.decidedAt).toBeInstanceOf(Date);
    expect(election.page.id).toBe(page.id);

    // The decision lives on the manifest row.
    const manifest = await run(listRoundPages(current.id));
    expect(manifest[0]!.chosenVariantId).toBe(tabs.id);
  });

  it("electing in one round does not affect another round", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, rail, tabs } = await seedPageWithTwoVariants(proto.id);
    const roundV1 = (await run(getCurrentRound(proto.id)))!;

    // Elect rail in v1, then open v2 (clone) and elect tabs there.
    await run(electVariant(rail.id, { rationale: "v1 pick", roundId: roundV1.id }));
    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }),
    );
    await run(electVariant(tabs.id, { rationale: "v2 pick", roundId: roundV2.id }));

    const v1Manifest = await run(listRoundPages(roundV1.id));
    const v2Manifest = await run(listRoundPages(roundV2.id));
    expect(v1Manifest.find((e) => e.pageId === page.id)!.chosenVariantId).toBe(rail.id);
    expect(v2Manifest.find((e) => e.pageId === page.id)!.chosenVariantId).toBe(tabs.id);
  });

  it("createRound({ fromRoundId }) inherits each page's election", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);
    const roundV1 = (await run(getCurrentRound(proto.id)))!;
    await run(electVariant(tabs.id, { rationale: "v1 decision", decidedBy: "po" }));

    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }),
    );
    const cloned = await run(listRoundPages(roundV2.id));
    const entry = cloned.find((e) => e.pageId === page.id)!;
    expect(entry.chosenVariantId).toBe(tabs.id);
    expect(entry.decisionRationale).toBe("v1 decision");
    expect(entry.decidedBy).toBe("po");
    expect(entry.decidedAt).toBeInstanceOf(Date);
  });

  it("advancing a page's pinned version (new version) resets its election in the round", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(electVariant(tabs.id, { rationale: "decided on v1" }));

    // The election holds while the pin is unchanged…
    let manifest = await run(listRoundPages(current.id));
    expect(manifest.find((e) => e.pageId === page.id)!.chosenVariantId).toBe(tabs.id);

    // …and resets the moment a new version advances the current round's pin.
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    manifest = await run(listRoundPages(current.id));
    const entry = manifest.find((e) => e.pageId === page.id)!;
    expect(entry.pageVersionId).toBe(v2.id);
    expect(entry.chosenVariantId).toBeNull();
    expect(entry.decisionRationale).toBeNull();
    expect(entry.decidedBy).toBeNull();
    expect(entry.decidedAt).toBeNull();
  });

  it("rejects electing a variant from an older version than the round pin", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);

    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    await run(
      addVariant({ pageVersionId: v2.id, label: "fresh", title: "Fresh", htmlContent: "<p/>" }),
    );

    await expect(run(electVariant(tabs.id, { rationale: "old pick" }))).rejects.toThrow(
      /pins version/,
    );
  });

  it("re-pinning the SAME version leaves the election intact (idempotent)", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, version, tabs } = await seedPageWithTwoVariants(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(electVariant(tabs.id, { rationale: "decided" }));

    await run(pinPage(current.id, page.id, version.id));
    const manifest = await run(listRoundPages(current.id));
    expect(manifest.find((e) => e.pageId === page.id)!.chosenVariantId).toBe(tabs.id);
  });

  it("clearElection clears the election on the current round's (round, page) row", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(electVariant(tabs.id, { rationale: "decided" }));

    const cleared = await run(clearElection(page.id));
    expect(cleared.chosenVariantId).toBeNull();
    expect(cleared.decisionRationale).toBeNull();
    expect(cleared.page.id).toBe(page.id);

    const manifest = await run(listRoundPages(current.id));
    expect(manifest.find((e) => e.pageId === page.id)!.chosenVariantId).toBeNull();
  });

  it("electing a page not in the round's manifest is rejected", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(dropPage(current.id, page.id));

    await expect(run(electVariant(tabs.id, { rationale: "x" }))).rejects.toThrow(/not in round/i);
  });

  it("evaluateDesignReadiness blocks on the current round's election, then on the placement", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, tabs } = await seedPageWithTwoVariants(proto.id);

    // ≥ 2 variants, no round election → blocked on the choice.
    let r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.reasons.join(" ")).toMatch(/page 'home' has 2 variant\(s\) but no elected design/);

    // Electing in the current round satisfies the choice; now only the missing
    // per-page placement blocks (PRD 0030 / issue 02 safety net).
    await run(electVariant(tabs.id, { rationale: "decided" }));
    const current = (await run(getCurrentRound(proto.id)))!;
    r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.reasons.join(" ")).not.toMatch(/no elected design/);
    expect(r.reasons.join(" ")).toMatch(/page 'home' is decided but has no distilled placement/);

    // Distilling the page's placement clears the gate.
    await run(
      distillPagePlacement(current.id, page.id, {
        placementSpec: "## Regions\nHeader, list.\n\n## Order\nHeader then list.",
      }),
    );
    r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(false);
  });

  it("a mono-variant page is retained by default but still needs a placement", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "solo", title: "Solo" }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({ pageVersionId: version.id, label: "only", title: "Only", htmlContent: "<p/>" }),
    );

    // Retained by default (no election needed), but decided ⇒ a placement is
    // required for the current round.
    let r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.reasons.join(" ")).not.toMatch(/no elected design/);
    expect(r.reasons.join(" ")).toMatch(/page 'solo' is decided but has no distilled placement/);

    const current = (await run(getCurrentRound(proto.id)))!;
    await run(
      distillPagePlacement(current.id, page.id, {
        placementSpec: "## Regions\nSingle column.\n\n## Order\nTop to bottom.",
      }),
    );
    r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(false);
  });

  it("forkPrototypes carries the round-scoped election, remapping the variant id", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { tabs } = await seedPageWithTwoVariants(proto.id);
    await run(electVariant(tabs.id, { rationale: "fork me" }));

    const otherRev = (await run(createPrd({ projectId, title: "Y" }))).id;
    await run(forkPrototypes(prdRevisionId, otherRev));

    const forked = (await run(listPrototypes(otherRev)))[0]!;
    const forkedCurrent = (await run(getCurrentRound(forked.id)))!;
    const forkedManifest = await run(listRoundPages(forkedCurrent.id));
    const entry = forkedManifest[0]!;
    expect(entry.chosenVariantId).not.toBeNull();
    // Remapped to the fork's own variant id, never the source's.
    expect(entry.chosenVariantId).not.toBe(tabs.id);
    expect(entry.decisionRationale).toBe("fork me");
  });
});

/**
 * Per-(round, page) distilled placement (PRD 0030 / issue 02). The placement
 * markdown lives in `prd_round_page_design`, keyed by `(round, page)`, authored
 * on the fly via `distillPagePlacement`. It is round-scoped, inherited on a
 * round clone, and reset (row removed) when the page's pinned version advances —
 * mirroring the round-scoped election.
 */
describe("per-(round, page) placement (PRD 0030 / 02)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  const SPEC = "## Regions\nHeader on top, list below.\n\n## Order\nHeader, list, FAB.";

  async function seedPage(prototypeId: string, pageSlug = "home") {
    const page = await run(addPage({ prototypeId, slug: pageSlug, title: pageSlug }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({ pageVersionId: version.id, label: "main", title: "Main", htmlContent: "<p/>" }),
    );
    return { page, version };
  }

  it("distillPagePlacement upserts the placement on the (round, page); re-distill overwrites", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;

    const first = await run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC }));
    expect(first.roundId).toBe(current.id);
    expect(first.pageId).toBe(page.id);
    expect(first.placementSpec).toBe(SPEC);
    expect(first.distilledAt).toBeInstanceOf(Date);

    const stored = await run(getRoundPagePlacement(current.id, page.id));
    expect(stored?.placementSpec).toBe(SPEC);

    const NEXT = "## Regions\nTwo columns.\n\n## Order\nLeft then right.";
    const second = await run(distillPagePlacement(current.id, page.id, { placementSpec: NEXT }));
    expect(second.placementSpec).toBe(NEXT);
    // Still exactly one row for the (round, page).
    expect((await run(getRoundPagePlacement(current.id, page.id)))?.placementSpec).toBe(NEXT);
  });

  it("getRoundPagePlacement returns null when the page was never distilled", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    expect(await run(getRoundPagePlacement(current.id, page.id))).toBeNull();
  });

  it("section guard: refuses a spec missing ## Regions or ## Order, accepts one with both", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;

    await expect(
      run(distillPagePlacement(current.id, page.id, { placementSpec: "just some prose" })),
    ).rejects.toThrow(/Regions/);
    await expect(
      run(
        distillPagePlacement(current.id, page.id, {
          placementSpec: "## Regions\nonly regions here",
        }),
      ),
    ).rejects.toThrow(/Order/);
    // Empty spec is refused too.
    await expect(
      run(distillPagePlacement(current.id, page.id, { placementSpec: "   " })),
    ).rejects.toThrow(/must not be empty/);

    const ok = await run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC }));
    expect(ok.placementSpec).toBe(SPEC);
  });

  it("refuses distilling a page that is not in the round's manifest", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(dropPage(current.id, page.id));

    await expect(
      run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC })),
    ).rejects.toThrow(/not in round/i);
  });

  it("is round-scoped: distilling in one round does not affect another", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const roundV1 = (await run(getCurrentRound(proto.id)))!;
    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }),
    );

    const V2SPEC = "## Regions\nv2 regions.\n\n## Order\nv2 order.";
    await run(distillPagePlacement(roundV2.id, page.id, { placementSpec: V2SPEC }));

    // v1 keeps whatever it had (nothing); v2 carries the new spec.
    expect((await run(getRoundPagePlacement(roundV2.id, page.id)))?.placementSpec).toBe(V2SPEC);

    const V1SPEC = "## Regions\nv1 regions.\n\n## Order\nv1 order.";
    await run(distillPagePlacement(roundV1.id, page.id, { placementSpec: V1SPEC }));
    expect((await run(getRoundPagePlacement(roundV1.id, page.id)))?.placementSpec).toBe(V1SPEC);
    // v2 is untouched by the v1 distill.
    expect((await run(getRoundPagePlacement(roundV2.id, page.id)))?.placementSpec).toBe(V2SPEC);
  });

  it("createRound({ fromRoundId }) inherits each page's placement", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const roundV1 = (await run(getCurrentRound(proto.id)))!;
    const first = await run(distillPagePlacement(roundV1.id, page.id, { placementSpec: SPEC }));

    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }),
    );
    const inherited = await run(getRoundPagePlacement(roundV2.id, page.id));
    expect(inherited?.placementSpec).toBe(SPEC);
    // The inherited row keeps the original distilledAt (carried, not re-stamped).
    expect(inherited?.distilledAt.getTime()).toBe(first.distilledAt.getTime());
  });

  it("advancing a page's pinned version resets (removes) its placement in the round", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC }));
    expect(await run(getRoundPagePlacement(current.id, page.id))).not.toBeNull();

    // A new version advances the current round's pin in place → placement reset.
    await run(addVersion({ pageId: page.id, label: "v2" }));
    expect(await run(getRoundPagePlacement(current.id, page.id))).toBeNull();
  });

  it("re-pinning the SAME version leaves the placement intact (idempotent)", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page, version } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC }));

    await run(pinPage(current.id, page.id, version.id));
    expect((await run(getRoundPagePlacement(current.id, page.id)))?.placementSpec).toBe(SPEC);
  });

  it("forkPrototypes carries the (round, page) placement, remapping the page id", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC }));

    const otherRev = (await run(createPrd({ projectId, title: "Y" }))).id;
    await run(forkPrototypes(prdRevisionId, otherRev));

    const forked = (await run(listPrototypes(otherRev)))[0]!;
    const forkedCurrent = (await run(getCurrentRound(forked.id)))!;
    const forkedManifest = await run(listRoundPages(forkedCurrent.id));
    const forkedPageId = forkedManifest[0]!.pageId;
    expect(forkedPageId).not.toBe(page.id);
    const placement = await run(getRoundPagePlacement(forkedCurrent.id, forkedPageId));
    expect(placement?.placementSpec).toBe(SPEC);
  });

  it("removePage --cascade drops the page's placement rows", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(distillPagePlacement(current.id, page.id, { placementSpec: SPEC }));

    await run(removePage(page.id, { cascade: true }));
    // The placement row is gone with the page (no orphan FK).
    expect(await run(getRoundPagePlacement(current.id, page.id))).toBeNull();
  });

  it("removePage --cascade drops task-to-page links before deleting the page", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const { page } = await seedPage(proto.id);
    const task = await run(
      createTask({
        prdRevisionId,
        title: "Build home",
        description: "Build the page",
        doneCriteria: "Page exists",
        effort: "m",
      }),
    );
    await db.insert(taskPrototypePages).values({ taskId: task.id, pageId: page.id });

    await run(removePage(page.id, { cascade: true }));

    expect(await db.select().from(taskPrototypePages)).toEqual([]);
  });
});

/**
 * Round = frozen snapshot (PRD 0030 / issue 03). A round is the unit the user
 * sees and iterates. Feedback ⇒ a NEW round: open the next round (clone of the
 * current one in pointers), then iterate the changed pages inside it. The
 * previous round, no longer the current one, stays FROZEN — its pins never move
 * and it remains resolvable/browsable. Unchanged pages carry forward by pointer:
 * no HTML duplication, no new `page_version`. The data bricks are unchanged
 * (`createRound({ fromRoundId })` clones in pointers; `addVersion` auto-advances
 * the current round's pin); this block demonstrates the snapshot protocol that
 * stands on top of them.
 */
describe("round = frozen snapshot, feedback ⇒ new round (PRD 0030 / 03)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;
  let projectId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    projectId = (await run(createProject({ name: "p" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  });

  async function seedPageWithMainVariant(prototypeId: string, slug: string) {
    const page = await run(addPage({ prototypeId, slug, title: slug }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const variant = await run(
      addVariant({ pageVersionId: v1.id, label: "main", title: "Main", htmlContent: "<p/>" }),
    );
    return { page, v1, variant };
  }

  it("iterating a page in the NEW round leaves the previous round's pin frozen", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const home = await seedPageWithMainVariant(proto.id, "home");
    const roundV1 = (await run(getCurrentRound(proto.id)))!;
    // The previous round pins the page at v1.
    expect((await run(listRoundPages(roundV1.id)))[0]!.pageVersionId).toBe(home.v1.id);

    // Feedback ⇒ open the next round (clone of the current one, pointers only),
    // then iterate the changed page inside it. addVersion auto-advances the pin
    // of the NEW current round only.
    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }),
    );
    const v2 = await run(addVersion({ pageId: home.page.id, label: "v2-after-feedback" }));

    // The new round points at the new version…
    const v2Entry = (await run(listRoundPages(roundV2.id))).find((e) => e.pageId === home.page.id)!;
    expect(v2Entry.pageVersionId).toBe(v2.id);

    // …while the previous round stays FROZEN at v1 — its pin never moved.
    const frozen = (await run(listRoundPages(roundV1.id))).find((e) => e.pageId === home.page.id)!;
    expect(frozen.pageVersionId).toBe(home.v1.id);

    // And the previous round is still fully resolvable/browsable at v1.
    const resolved = await run(
      resolveVariant({
        prototypeId: proto.id,
        pageSlug: "home",
        variantLabel: null,
        roundId: roundV1.id,
      }),
    );
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.version.id).toBe(home.v1.id);
    expect(resolved.variant.id).toBe(home.variant.id);
  });

  it("an UNCHANGED page is carried forward by pointer — no new page_version, no HTML duplication", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const home = await seedPageWithMainVariant(proto.id, "home");
    const settings = await seedPageWithMainVariant(proto.id, "settings");
    const roundV1 = (await run(getCurrentRound(proto.id)))!;

    const versionsBefore =
      (await run(listVersions(home.page.id))).length +
      (await run(listVersions(settings.page.id))).length;

    // Open the next round, then iterate ONLY `home`. `settings` is untouched.
    const roundV2 = await run(
      createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }),
    );
    await run(addVersion({ pageId: home.page.id, label: "v2" }));

    // `settings` has NOT gained a version — it is carried forward by pointer.
    expect(await run(listVersions(settings.page.id))).toHaveLength(1);
    // Only `home` gained a version; total grew by exactly one.
    const versionsAfter =
      (await run(listVersions(home.page.id))).length +
      (await run(listVersions(settings.page.id))).length;
    expect(versionsAfter).toBe(versionsBefore + 1);

    // The new round pins `settings` at the SAME version the previous round did.
    const v1Settings = (await run(listRoundPages(roundV1.id))).find(
      (e) => e.pageId === settings.page.id,
    )!;
    const v2Settings = (await run(listRoundPages(roundV2.id))).find(
      (e) => e.pageId === settings.page.id,
    )!;
    expect(v2Settings.pageVersionId).toBe(v1Settings.pageVersionId);
    expect(v2Settings.pageVersionId).toBe(settings.v1.id);

    // The unchanged page resolves identically in both rounds (same HTML, by pointer).
    const inV1 = await run(
      resolveVariant({
        prototypeId: proto.id,
        pageSlug: "settings",
        variantLabel: null,
        roundId: roundV1.id,
      }),
    );
    const inV2 = await run(
      resolveVariant({
        prototypeId: proto.id,
        pageSlug: "settings",
        variantLabel: null,
        roundId: roundV2.id,
      }),
    );
    if (inV1.kind !== "resolved" || inV2.kind !== "resolved") throw new Error("expected resolved");
    expect(inV2.variant.id).toBe(inV1.variant.id);
    expect(inV2.variant.id).toBe(settings.variant.id);
  });

  it("the previous round keeps its own election + placement frozen across a new round", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const home = await seedPageWithMainVariant(proto.id, "home");
    const roundV1 = (await run(getCurrentRound(proto.id)))!;
    await run(
      distillPagePlacement(roundV1.id, home.page.id, {
        placementSpec: "## Regions\nHeader, body.\n\n## Order\nHeader then body.",
      }),
    );

    // Feedback ⇒ new round, then iterate `home` (its pin advances in v2 → its
    // v2 placement resets, per issue 02 — but v1 must stay untouched).
    await run(createRound({ prototypeId: proto.id, label: "v2", fromRoundId: roundV1.id }));
    await run(addVersion({ pageId: home.page.id, label: "v2" }));

    // The previous round still carries the placement it was distilled with.
    const frozenPlacement = await run(getRoundPagePlacement(roundV1.id, home.page.id));
    expect(frozenPlacement?.placementSpec).toMatch(/Header, body/);
  });
});
