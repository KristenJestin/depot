import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd, distillDesign } from "#/modules/prds/domain";
import {
  addFeedback,
  addPage,
  addVariant,
  addVersion,
  archivePrototype,
  archiveVersion,
  clearElection,
  createPrototype,
  deleteFeedback,
  distillPagePlacement,
  electVariant,
  evaluateDesignReadiness,
  forkPrototypes,
  getCurrentRound,
  getPrototype,
  ignoreFeedback,
  lintSelfContainedHtml,
  listFeedbacks,
  listPages,
  listPrototypes,
  listRoundPages,
  listVariants,
  listVersions,
  loadPrototypeTree,
  removePage,
  removeVariant,
  resolveFeedback,
  resolveVariant,
  restoreVersion,
  setMainVariant,
} from "#/modules/prds/prototypes";
import type { Database } from "#/db/client";

/**
 * Domain coverage for the prototype subsystem (PRD 0025 / T1). Hits every
 * invariant the SQL schema cannot express alone — slug shape, exactly-1 main
 * per page version, stale-version feedback refusal, resolve / ignore
 * semantics, archive / restore, and the fork helper.
 */
describe("prototypes domain (PRD 0025 / T1)", () => {
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

  it("creates a prototype with a kebab-case slug", async () => {
    const proto = await run(
      createPrototype({ prdRevisionId, slug: "jobs-rework", description: "rework jobs" }),
    );
    expect(proto.slug).toBe("jobs-rework");
    expect(proto.prdRevisionId).toBe(prdRevisionId);
    expect(proto.archivedAt).toBeNull();
  });

  it("rejects an invalid prototype slug", async () => {
    await expect(run(createPrototype({ prdRevisionId, slug: "Bad Slug" }))).rejects.toThrow(
      /kebab-case/,
    );
    await expect(run(createPrototype({ prdRevisionId, slug: "-leading" }))).rejects.toThrow(
      /kebab-case/,
    );
    await expect(run(createPrototype({ prdRevisionId, slug: "" }))).rejects.toThrow(/empty/);
  });

  it("refuses a duplicate prototype slug on the same revision", async () => {
    await run(createPrototype({ prdRevisionId, slug: "jobs" }));
    await expect(run(createPrototype({ prdRevisionId, slug: "jobs" }))).rejects.toThrow(
      /already exists/,
    );
  });

  it("adds pages and refuses duplicate slugs per prototype", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    await expect(
      run(addPage({ prototypeId: proto.id, slug: "home", title: "Home again" })),
    ).rejects.toThrow(/already exists/);
    const pages = await run(listPages(proto.id));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.slug).toBe("home");
  });

  it("adds page versions in createdAt order; first variant added is main", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const a = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p>rail</p>",
      }),
    );
    expect(a.isMain).toBe(true);
    const b = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p>tabs</p>",
      }),
    );
    expect(b.isMain).toBe(false);
    const variants = await run(listVariants(v1.id));
    expect(variants.filter((v) => v.isMain)).toHaveLength(1);
  });

  it("rejects a variant whose HTML pulls external resources (CDN / script / link)", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const html = [
      "<!doctype html>",
      '<script src="https://cdn.tailwindcss.com"></script>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter">',
      "<body><p>x</p></body>",
    ].join("\n");
    await expect(
      run(addVariant({ pageVersionId: v1.id, label: "cdn", title: "CDN", htmlContent: html })),
    ).rejects.toThrow(/not self-contained/);
    expect(await run(listVariants(v1.id))).toHaveLength(0);
  });

  it("stores an external-resource variant when allowExternal is set", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "cdn",
        title: "CDN",
        htmlContent: '<script src="https://cdn.tailwindcss.com"></script><body>x</body>',
        allowExternal: true,
      }),
    );
    expect(v.htmlContent).toContain("cdn.tailwindcss.com");
  });

  it("lintSelfContainedHtml flags CDN / script / link but not plain hyperlinks or inline styles", () => {
    expect(lintSelfContainedHtml('<a href="https://example.com">x</a>')).toHaveLength(0);
    expect(lintSelfContainedHtml("<style>body{color:red}</style><body>ok</body>")).toHaveLength(0);
    const findings = lintSelfContainedHtml(
      '<script src="https://cdn.tailwindcss.com"></script>\n<link rel="stylesheet" href="//cdn.foo/x.css">',
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]!.reason).toMatch(/Tailwind CDN/);
    expect(findings[0]!.line).toBe(1);
    expect(findings[1]!.reason).toMatch(/link/);
    expect(findings[1]!.line).toBe(2);
  });

  it("setMainVariant flips main atomically", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const tabs = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
      }),
    );
    expect(rail.isMain).toBe(true);
    expect(tabs.isMain).toBe(false);

    const result = await run(setMainVariant(tabs.id));
    expect(result.previousMainId).toBe(rail.id);

    const after = await run(listVariants(v1.id));
    const mainLabels = after.filter((v) => v.isMain).map((v) => v.label);
    expect(mainLabels).toEqual(["tabs"]);
  });

  it("addVariant(markMain=true) when a main exists demotes the previous main", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const tabs = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
        markMain: true,
      }),
    );
    expect(tabs.isMain).toBe(true);
    const after = await run(listVariants(v1.id));
    expect(after.filter((v) => v.isMain).map((v) => v.label)).toEqual(["tabs"]);
  });

  it("resolves (pageSlug, null) to the main variant of the latest active version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail v1",
        htmlContent: "<p/>",
      }),
    );
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    const v2Rail = await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );
    const resolved = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.variant.id).toBe(v2Rail.id);
    expect(resolved.version.id).toBe(v2.id);
    expect(v1Rail).toBeDefined();
  });

  it("resolves (pageSlug, variantLabel) to that exact variant on the latest version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const tabs = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "tabs",
        title: "Tabs",
        htmlContent: "<p/>",
      }),
    );
    const resolved = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: "tabs" }),
    );
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.variant.id).toBe(tabs.id);
  });

  it("fails to resolve when the page slug is unknown", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    await expect(
      run(resolveVariant({ prototypeId: proto.id, pageSlug: "unknown" })),
    ).rejects.toThrow(/no page with slug/);
  });

  it("fails to resolve when the variant label is missing on the latest version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    await expect(
      run(resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: "missing" })),
    ).rejects.toThrow(/Prototype variant not found/);
  });

  it("resolution follows the current round's manifest pin, not version archive state", async () => {
    // Round-relative resolution pins an explicit version via the manifest;
    // archiving that version does not silently re-resolve to an older one (the
    // pin is the round's decision). `addVersion` auto-advances the pin, so the
    // current round tracks the page's latest version automatically.
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail v1",
        htmlContent: "<p/>",
      }),
    );
    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    const v2Rail = await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );

    // Current round auto-advanced its pin to v2 on the second addVersion.
    const resolved = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") throw new Error("expected resolved");
    expect(resolved.version.id).toBe(v2.id);
    expect(resolved.variant.id).toBe(v2Rail.id);
    expect(v1Rail).toBeDefined();

    // Archiving the pinned version leaves the manifest pin intact: still v2.
    await run(archiveVersion(v2.id));
    const afterArchive = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    expect(afterArchive.kind).toBe("resolved");
    if (afterArchive.kind !== "resolved") throw new Error("expected resolved");
    expect(afterArchive.version.id).toBe(v2.id);

    await run(restoreVersion(v2.id));
    const afterRestore = await run(
      resolveVariant({ prototypeId: proto.id, pageSlug: "home", variantLabel: null }),
    );
    expect(afterRestore.kind).toBe("resolved");
    if (afterRestore.kind !== "resolved") throw new Error("expected resolved");
    expect(afterRestore.version.id).toBe(v2.id);
  });

  it("addFeedback on the latest version succeeds; on a stale version it raises", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail v1",
        htmlContent: "<p/>",
      }),
    );

    const fb = await run(addFeedback({ variantId: v1Rail.id, text: "First retour" }));
    expect(fb.status).toBe("open");
    expect(fb.text).toBe("First retour");

    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );

    await expect(run(addFeedback({ variantId: v1Rail.id, text: "Late retour" }))).rejects.toThrow(
      /no longer the latest non-archived/,
    );
  });

  it("resolveFeedback writes resolution_* fields but leaves status open", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail v1",
        htmlContent: "<p/>",
      }),
    );
    const fb = await run(addFeedback({ variantId: v1Rail.id, text: "fix the CTA" }));

    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    const v2Rail = await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );

    const resolved = await run(
      resolveFeedback(fb.id, { note: "Moved CTA to header", viaVariantId: v2Rail.id }),
    );
    expect(resolved.status).toBe("open");
    expect(resolved.resolutionNote).toBe("Moved CTA to header");
    expect(resolved.resolutionViaVariantId).toBe(v2Rail.id);
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it("resolveFeedback without options still stamps resolvedAt", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await run(addFeedback({ variantId: v1Rail.id, text: "x" }));
    const resolved = await run(resolveFeedback(fb.id));
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.resolutionNote).toBeNull();
    expect(resolved.resolutionViaVariantId).toBeNull();
    expect(resolved.status).toBe("open");
  });

  it("ignoreFeedback rejects an empty reason and accepts a non-empty one", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await run(addFeedback({ variantId: v1Rail.id, text: "x" }));

    await expect(run(ignoreFeedback(fb.id, { reason: "   " }))).rejects.toThrow(
      /must not be empty/,
    );

    const ignored = await run(ignoreFeedback(fb.id, { reason: "out of scope for this iteration" }));
    expect(ignored.status).toBe("ignored");
    expect(ignored.ignoredReason).toBe("out of scope for this iteration");
    expect(ignored.ignoredAt).toBeInstanceOf(Date);
  });

  it("deleteFeedback removes the row when targeting the latest version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const fb = await run(addFeedback({ variantId: v1Rail.id, text: "delete me" }));

    const deleted = await run(deleteFeedback(fb.id));
    expect(deleted.id).toBe(fb.id);

    const after = await run(listFeedbacks(prdRevisionId));
    expect(after.find((f) => f.id === fb.id)).toBeUndefined();
  });

  it("deleteFeedback refuses to delete a feedback on a stale version", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail v1",
        htmlContent: "<p/>",
      }),
    );
    const fb = await run(addFeedback({ variantId: v1Rail.id, text: "leave me" }));

    const v2 = await run(addVersion({ pageId: page.id, label: "v2" }));
    await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail",
        title: "Rail v2",
        htmlContent: "<p/>",
      }),
    );

    await expect(run(deleteFeedback(fb.id))).rejects.toThrow(/no longer the latest non-archived/);

    const after = await run(listFeedbacks(prdRevisionId));
    expect(after.find((f) => f.id === fb.id)).toBeDefined();
  });

  it("listFeedbacks filters by status and variant", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    const a = await run(addFeedback({ variantId: v1Rail.id, text: "a" }));
    const b = await run(addFeedback({ variantId: v1Rail.id, text: "b" }));
    await run(ignoreFeedback(b.id, { reason: "no" }));

    const open = await run(listFeedbacks(prdRevisionId, { status: "open" }));
    expect(open.map((f) => f.id)).toEqual([a.id]);
    const ignored = await run(listFeedbacks(prdRevisionId, { status: "ignored" }));
    expect(ignored.map((f) => f.id)).toEqual([b.id]);
    const onlyVariant = await run(listFeedbacks(prdRevisionId, { variantId: v1Rail.id }));
    expect(onlyVariant).toHaveLength(2);
  });

  it("forkPrototypes recopies prototypes, pages, versions, variants, and feedback with new IDs", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    const v1Rail = await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    await run(addFeedback({ variantId: v1Rail.id, text: "pin me" }));

    const otherRev = (await run(createPrd({ projectId, title: "Y" }))).id;

    await run(forkPrototypes(prdRevisionId, otherRev));
    const copied = await run(listPrototypes(otherRev));
    expect(copied).toHaveLength(1);
    expect(copied[0]!.slug).toBe("p");
    expect(copied[0]!.id).not.toBe(proto.id);

    const newPages = await run(listPages(copied[0]!.id));
    expect(newPages[0]!.slug).toBe("home");
    expect(newPages[0]!.id).not.toBe(page.id);

    const newVersions = await run(listVersions(newPages[0]!.id));
    expect(newVersions[0]!.label).toBe("v1");
    const newVariants = await run(listVariants(newVersions[0]!.id));
    expect(newVariants[0]!.htmlContent).toBe("<p/>");
    expect(newVariants[0]!.isMain).toBe(true);

    const tree = await run(loadPrototypeTree(copied[0]!.id));
    const feedbacks = tree.pages[0]!.versions[0]!.feedbacks;
    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0]!.text).toBe("pin me");
  });

  it("removePage refuses when versions exist without --cascade, and cascades when asked", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "home", title: "Home" }));
    const v1 = await run(addVersion({ pageId: page.id, label: "v1" }));
    await run(
      addVariant({
        pageVersionId: v1.id,
        label: "rail",
        title: "Rail",
        htmlContent: "<p/>",
      }),
    );
    await expect(run(removePage(page.id))).rejects.toThrow(/version\(s\) attached/);
    const removed = await run(removePage(page.id, { cascade: true }));
    expect(removed.id).toBe(page.id);
    expect(await run(listPages(proto.id))).toHaveLength(0);
  });

  it("archivePrototype marks the prototype archived but keeps the rows queryable", async () => {
    const proto = await run(createPrototype({ prdRevisionId, slug: "p" }));
    const archived = await run(archivePrototype(proto.id));
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const fetched = await run(getPrototype(proto.id));
    expect(fetched.archivedAt).toBeInstanceOf(Date);
  });
});

/**
 * Variant election (PRD 0028 / T1, round-scoped per PRD 0030 / 01 — design
 * lock). Electing records THE variant to build per `(round, page)` plus the
 * arbitration record, distinct from per-version `is_main`. The election lives on
 * the current round's manifest row, not the page.
 */
describe("prototype election (PRD 0028 / T1)", () => {
  let db: Database;
  let run: ReturnType<typeof makeRun>;
  let prdRevisionId: string;

  beforeEach(async () => {
    db = createTestDb().db;
    run = makeRun(db);
    const projectId = (await run(createProject({ name: "elect" }))).id;
    prdRevisionId = (await run(createPrd({ projectId, title: "Elect PRD" }))).id;
  });

  async function seedPageWithTwoVariants() {
    const proto = await run(createPrototype({ prdRevisionId, slug: "jobs" }));
    const page = await run(addPage({ prototypeId: proto.id, slug: "list", title: "List" }));
    const version = await run(addVersion({ pageId: page.id, label: "v1" }));
    const rail = await run(
      addVariant({ pageVersionId: version.id, label: "rail", title: "Rail", htmlContent: "<p/>" }),
    );
    const tabs = await run(
      addVariant({ pageVersionId: version.id, label: "tabs", title: "Tabs", htmlContent: "<p/>" }),
    );
    return { proto, page, version, rail, tabs };
  }

  it("records chosenVariantId + arbitration on the (round, page) manifest row", async () => {
    const { proto, page, tabs } = await seedPageWithTwoVariants();
    const election = await run(
      electVariant(tabs.id, { rationale: "clearest hierarchy", decidedBy: "direction" }),
    );
    expect(election.page.id).toBe(page.id);
    expect(election.chosenVariantId).toBe(tabs.id);
    expect(election.decisionRationale).toBe("clearest hierarchy");
    expect(election.decidedBy).toBe("direction");
    expect(election.decidedAt).toBeInstanceOf(Date);

    const current = (await run(getCurrentRound(proto.id)))!;
    const manifest = await run(listRoundPages(current.id));
    expect(manifest.find((e) => e.pageId === page.id)!.chosenVariantId).toBe(tabs.id);
  });

  it("re-electing overwrites the previous choice", async () => {
    const { proto, page, rail, tabs } = await seedPageWithTwoVariants();
    await run(electVariant(rail.id, { rationale: "first call" }));
    await run(electVariant(tabs.id, { rationale: "changed our mind" }));
    const current = (await run(getCurrentRound(proto.id)))!;
    const entry = (await run(listRoundPages(current.id))).find((e) => e.pageId === page.id)!;
    expect(entry.chosenVariantId).toBe(tabs.id);
    expect(entry.decisionRationale).toBe("changed our mind");
    expect(entry.decidedBy).toBeNull();
  });

  it("is independent of is_main (electing does not move the main variant)", async () => {
    const { page, version, rail, tabs } = await seedPageWithTwoVariants();
    // `rail` is auto-main (first variant added); electing `tabs` must not touch it.
    const election = await run(electVariant(tabs.id, { rationale: "elected is not main" }));
    expect(election.chosenVariantId).toBe(tabs.id);
    expect(election.page.id).toBe(page.id);
    const variants = await run(listVariants(version.id));
    expect(variants.find((v) => v.id === rail.id)?.isMain).toBe(true);
    expect(variants.find((v) => v.id === tabs.id)?.isMain).toBe(false);
  });

  it("rejects an empty rationale", async () => {
    const { tabs } = await seedPageWithTwoVariants();
    await expect(run(electVariant(tabs.id, { rationale: "   " }))).rejects.toThrow(/rationale/);
  });

  it("clearElection reverts the (round, page) to no design chosen", async () => {
    const { proto, page, tabs } = await seedPageWithTwoVariants();
    await run(electVariant(tabs.id, { rationale: "x" }));
    const cleared = await run(clearElection(page.id));
    expect(cleared.chosenVariantId).toBeNull();
    expect(cleared.decisionRationale).toBeNull();
    expect(cleared.decidedBy).toBeNull();
    expect(cleared.decidedAt).toBeNull();
    const current = (await run(getCurrentRound(proto.id)))!;
    const entry = (await run(listRoundPages(current.id))).find((e) => e.pageId === page.id)!;
    expect(entry.chosenVariantId).toBeNull();
  });

  it("removing the elected variant clears the round election (no dangling id)", async () => {
    const { proto, page, tabs } = await seedPageWithTwoVariants();
    await run(electVariant(tabs.id, { rationale: "chosen then deleted" }));
    await run(removeVariant(tabs.id));
    const current = (await run(getCurrentRound(proto.id)))!;
    const entry = (await run(listRoundPages(current.id))).find((e) => e.pageId === page.id)!;
    expect(entry.chosenVariantId).toBeNull();
    expect(entry.decisionRationale).toBeNull();
  });

  it("design readiness: a revision with no prototypes is never blocked", async () => {
    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(false);
  });

  it("design readiness: blocked while a page has variants but no elected design", async () => {
    await seedPageWithTwoVariants();
    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/no elected design/);
  });

  it("design readiness: still blocked when elected but not yet distilled", async () => {
    const { tabs } = await seedPageWithTwoVariants();
    await run(electVariant(tabs.id, { rationale: "x" }));
    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(true);
    expect(r.reasons.join(" ")).toMatch(/no distilled placement/);
  });

  it("design readiness: clear once every page is elected and the placement is distilled", async () => {
    const { proto, page, tabs } = await seedPageWithTwoVariants();
    await run(electVariant(tabs.id, { rationale: "x" }));
    const current = (await run(getCurrentRound(proto.id)))!;
    await run(
      distillPagePlacement(current.id, page.id, {
        placementSpec: "## Regions\nHeader on top, list below.\n\n## Order\nHeader, list, FAB.",
      }),
    );
    const r = await run(evaluateDesignReadiness(prdRevisionId));
    expect(r.blocked).toBe(false);
  });

  it("distillDesign upserts the global placement lock; re-distill overwrites it (legacy compat)", async () => {
    await run(distillDesign(prdRevisionId, { placementSpec: "v1 layout" }));
    const updated = await run(distillDesign(prdRevisionId, { placementSpec: "v2 layout" }));
    expect(updated.placementSpec).toBe("v2 layout");
    expect(updated.distilledAt).toBeInstanceOf(Date);
    await expect(run(distillDesign(prdRevisionId, { placementSpec: "  " }))).rejects.toThrow(
      /placement spec/,
    );
  });
});
