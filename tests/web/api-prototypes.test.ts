import { describe, it, expect, beforeAll, vi } from "vite-plus/test";
import { Layer, ManagedRuntime } from "effect";
import type { Database } from "#/db/client";
import { createTestDb, makeRun } from "../helpers/db";
import { createProject } from "#/modules/projects/domain";
import { createPrd } from "#/modules/prds/domain";
import {
  addFeedback,
  addPage,
  addVariant,
  addVersion,
  createPrototype,
} from "#/modules/prds/prototypes";

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

let prdRevisionId: string;
let prototypeId: string;
let pageId: string;
let v1Id: string;
let v1RailId: string;
let v1TabsId: string;

beforeAll(async () => {
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getRuntime).mockReturnValue(ManagedRuntime.make(Layer.succeed(Db, db)));

  const projectId = (await run(createProject({ name: "web-proto" }))).id;
  prdRevisionId = (await run(createPrd({ projectId, title: "X" }))).id;
  const proto = await run(createPrototype({ prdRevisionId, slug: "jobs-rework" }));
  prototypeId = proto.id;
  const page = await run(addPage({ prototypeId, slug: "jobs-list", title: "Jobs" }));
  pageId = page.id;
  const v1 = await run(addVersion({ pageId, label: "v1" }));
  v1Id = v1.id;
  const v1Rail = await run(
    addVariant({
      pageVersionId: v1.id,
      label: "rail",
      title: "Rail",
      htmlContent: "<!doctype html><body><p>rail</p></body>",
    }),
  );
  v1RailId = v1Rail.id;
  const v1Tabs = await run(
    addVariant({
      pageVersionId: v1.id,
      label: "tabs",
      title: "Tabs",
      htmlContent: "<!doctype html><body><p>tabs</p></body>",
    }),
  );
  v1TabsId = v1Tabs.id;
});

describe("prototype web API (PRD 0025 / T1)", () => {
  it("GET /api/prd-revisions/:revId/prototypes lists prototypes", async () => {
    const res = await app.request(`/api/prd-revisions/${prdRevisionId}/prototypes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ slug: string }> };
    expect(body.items.map((p) => p.slug)).toEqual(["jobs-rework"]);
  });

  it("GET /api/prototypes/:protoId returns the tree", async () => {
    const res = await app.request(`/api/prototypes/${prototypeId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prototype: { slug: string };
      pages: Array<{ page: { slug: string }; versions: unknown[] }>;
    };
    expect(body.prototype.slug).toBe("jobs-rework");
    expect(body.pages[0]!.page.slug).toBe("jobs-list");
    expect(body.pages[0]!.versions).toHaveLength(1);
  });

  it("GET /api/prototype-variants/:variantId/raw serves the HTML + shim under an inline-script CSP", async () => {
    const res = await app.request(`/api/prototype-variants/${v1RailId}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy")!;
    // The sandbox is the security boundary; the CSP lets the prototype's own
    // inline scripts run (regression: a `nonce-…` policy rendered every
    // JS-driven variant blank) while `default-src 'none'` keeps it self-contained.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("script-src 'unsafe-inline' 'unsafe-eval'");
    expect(csp).not.toContain("nonce-");
    const html = await res.text();
    expect(html).toContain("<p>rail</p>");
    expect(html).toContain("depot-shim-style");
    expect(html).toContain(`<script type="text/javascript">`);
    expect(html).toContain("depot:set-feedback-mode");
    expect(html).toContain("depot:feedback-pin");
    expect(html).toContain("depot:nav");
  });

  it("GET /api/prototype-variants/:variantId/raw ships the dropped-page link logic (PRD 0029)", async () => {
    const res = await app.request(`/api/prototype-variants/${v1RailId}/raw`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // The shim greys out + intercepts links pointing at a page dropped from the
    // current round: it consumes `depot:mark-dropped-pages`, tags the matching
    // anchors with `depot-dropped-link`, and reports clicks as `depot:nav-dropped`.
    expect(html).toContain("depot:mark-dropped-pages");
    expect(html).toContain("depot-dropped-link");
    expect(html).toContain("depot:nav-dropped");
  });

  it("GET /api/prototype-variants/:variantId/raw keeps an author's inline script intact", async () => {
    const interactive = await run(
      addVariant({
        pageVersionId: v1Id,
        label: "interactive",
        title: "Interactive",
        htmlContent:
          '<!doctype html><body><div id="app"></div><script>document.getElementById("app").textContent="live";</script></body>',
      }),
    );
    const res = await app.request(`/api/prototype-variants/${interactive.id}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'unsafe-inline'");
    const html = await res.text();
    // The author script is served verbatim and the CSP above permits inline
    // execution, so it would populate #app instead of rendering blank.
    expect(html).toContain('<script>document.getElementById("app").textContent="live";</script>');
  });

  it("POST /api/prototype-variants/:variantId/feedback on latest version → 201", async () => {
    const res = await app.request(`/api/prototype-variants/${v1TabsId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Make CTA brighter", selectorCss: ".cta" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string; text: string } };
    expect(body.item.text).toBe("Make CTA brighter");
  });

  it("POST /api/prototype-variants/:variantId/feedback on stale version → 409", async () => {
    // Mint v2 so v1 becomes stale.
    const v2 = await run(addVersion({ pageId, label: "v2" }));
    await run(
      addVariant({
        pageVersionId: v2.id,
        label: "rail-refined",
        title: "Rail refined",
        htmlContent: "<p/>",
      }),
    );
    const res = await app.request(`/api/prototype-variants/${v1RailId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Too late" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("stale_version");
    void v1Id;
  });

  it("POST /api/feedbacks/:fbId/ignore rejects an empty reason with 400", async () => {
    const v2 = (
      await db.query.prdPrototypePageVersions.findMany({ where: { pageId, label: "v2" } })
    )[0]!;
    const v2Variant = (await db.query.prdPrototypeVariants.findFirst({
      where: { pageVersionId: v2.id },
    }))!;
    const onLatest = await run(addFeedback({ variantId: v2Variant.id, text: "on latest" }));

    const res = await app.request(`/api/feedbacks/${onLatest.id}/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/feedbacks/:fbId/ignore with reason → 200, status flipped", async () => {
    const v2 = (
      await db.query.prdPrototypePageVersions.findMany({ where: { pageId, label: "v2" } })
    )[0]!;
    const v2Variant = (await db.query.prdPrototypeVariants.findFirst({
      where: { pageVersionId: v2.id },
    }))!;
    const fb = await run(addFeedback({ variantId: v2Variant.id, text: "ignored target" }));
    const res = await app.request(`/api/feedbacks/${fb.id}/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "out of scope" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { status: string; ignoredReason: string } };
    expect(body.item.status).toBe("ignored");
    expect(body.item.ignoredReason).toBe("out of scope");
  });

  it("POST /api/feedbacks/:fbId/resolve sets resolution_* and keeps status open", async () => {
    const v2 = (
      await db.query.prdPrototypePageVersions.findMany({ where: { pageId, label: "v2" } })
    )[0]!;
    const v2Variant = (await db.query.prdPrototypeVariants.findFirst({
      where: { pageVersionId: v2.id },
    }))!;
    const fb = await run(addFeedback({ variantId: v2Variant.id, text: "resolve target" }));
    const res = await app.request(`/api/feedbacks/${fb.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Done", viaVariantId: v2Variant.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: { status: string; resolutionNote: string; resolvedAt: string | null };
    };
    expect(body.item.status).toBe("open");
    expect(body.item.resolutionNote).toBe("Done");
    expect(body.item.resolvedAt).not.toBeNull();
  });

  it("DELETE /api/feedbacks/:fbId on latest version → 200, row is gone", async () => {
    const v2 = (
      await db.query.prdPrototypePageVersions.findMany({ where: { pageId, label: "v2" } })
    )[0]!;
    const v2Variant = (await db.query.prdPrototypeVariants.findFirst({
      where: { pageVersionId: v2.id },
    }))!;
    const fb = await run(addFeedback({ variantId: v2Variant.id, text: "delete via api" }));

    const res = await app.request(`/api/feedbacks/${fb.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after).toBeUndefined();
  });

  it("DELETE /api/feedbacks/:fbId on unknown id → 404", async () => {
    const res = await app.request(`/api/feedbacks/does-not-exist`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("POST /api/prototype-variants/:variantId/elect sets the round election + logs the event", async () => {
    const page = await run(addPage({ prototypeId, slug: "elect-page-a", title: "Elect A" }));
    const ver = await run(addVersion({ pageId: page.id, label: "v1" }));
    const variant = await run(
      addVariant({
        pageVersionId: ver.id,
        label: "alpha",
        title: "Alpha",
        htmlContent: "<!doctype html><body><p>alpha</p></body>",
      }),
    );

    const res = await app.request(`/api/prototype-variants/${variant.id}/elect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rationale: "Cleanest layout" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: {
        chosenVariantId: string | null;
        decisionRationale: string | null;
        page: { id: string };
      };
    };
    expect(body.item.chosenVariantId).toBe(variant.id);
    expect(body.item.decisionRationale).toBe("Cleanest layout");
    expect(body.item.page.id).toBe(page.id);

    // The election lands on the current round's manifest row, not the page.
    const reloaded = await db.query.prdPrototypeRoundPages.findFirst({
      where: { pageId: page.id },
    });
    expect(reloaded?.chosenVariantId).toBe(variant.id);

    const events = await db.query.activityLog.findMany({ where: { prdRevisionId } });
    expect(events.some((e) => e.eventType === "prototype_variant_elected")).toBe(true);
  });

  it("POST /api/prototype-variants/:variantId/elect defaults the rationale when body is empty", async () => {
    const page = await run(addPage({ prototypeId, slug: "elect-page-b", title: "Elect B" }));
    const ver = await run(addVersion({ pageId: page.id, label: "v1" }));
    const variant = await run(
      addVariant({
        pageVersionId: ver.id,
        label: "beta",
        title: "Beta",
        htmlContent: "<!doctype html><body><p>beta</p></body>",
      }),
    );

    const res = await app.request(`/api/prototype-variants/${variant.id}/elect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { decisionRationale: string | null } };
    expect(body.item.decisionRationale).toBe("Elected from the web UI");
  });

  it("POST /api/prototype-variants/:variantId/elect on unknown id → 404", async () => {
    const res = await app.request(`/api/prototype-variants/does-not-exist/elect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rationale: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/prototype-pages/:pageId/election clears the election + logs the event", async () => {
    const page = await run(addPage({ prototypeId, slug: "elect-page-c", title: "Elect C" }));
    const ver = await run(addVersion({ pageId: page.id, label: "v1" }));
    const variant = await run(
      addVariant({
        pageVersionId: ver.id,
        label: "gamma",
        title: "Gamma",
        htmlContent: "<!doctype html><body><p>gamma</p></body>",
      }),
    );

    await app.request(`/api/prototype-variants/${variant.id}/elect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rationale: "for now" }),
    });

    const res = await app.request(`/api/prototype-pages/${page.id}/election`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: { chosenVariantId: string | null; page: { id: string } };
    };
    expect(body.item.chosenVariantId).toBeNull();
    expect(body.item.page.id).toBe(page.id);

    const reloaded = await db.query.prdPrototypeRoundPages.findFirst({
      where: { pageId: page.id },
    });
    expect(reloaded?.chosenVariantId).toBeNull();

    const events = await db.query.activityLog.findMany({ where: { prdRevisionId } });
    expect(events.some((e) => e.eventType === "prototype_variant_unelected")).toBe(true);
  });

  it("DELETE /api/prototype-pages/:pageId/election on unknown id → 404", async () => {
    const res = await app.request(`/api/prototype-pages/does-not-exist/election`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/feedbacks/:fbId on stale version → 409 stale_version", async () => {
    // Mint a fresh feedback against v2 (still the latest at this point), then
    // create v3 to make v2 stale and confirm the delete is refused.
    const v2 = (
      await db.query.prdPrototypePageVersions.findMany({ where: { pageId, label: "v2" } })
    )[0]!;
    const v2Variant = (await db.query.prdPrototypeVariants.findFirst({
      where: { pageVersionId: v2.id },
    }))!;
    const fb = await run(addFeedback({ variantId: v2Variant.id, text: "stale me" }));

    const v3 = await run(addVersion({ pageId, label: "v3" }));
    await run(
      addVariant({
        pageVersionId: v3.id,
        label: "rail",
        title: "Rail v3",
        htmlContent: "<p/>",
      }),
    );

    const res = await app.request(`/api/feedbacks/${fb.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("stale_version");

    const after = await db.query.prdPrototypeFeedback.findFirst({ where: { id: fb.id } });
    expect(after).toBeDefined();
  });
});
