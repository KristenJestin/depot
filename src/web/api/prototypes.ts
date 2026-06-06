import { Hono } from "hono";
import { Effect } from "effect";

import * as DomainPrototypes from "#/modules/prds/prototypes";
import * as DomainPrds from "#/modules/prds/domain";
import { logActivity } from "#/modules/activity/domain";
import { getRuntime } from "#/services/database";
import { VALID_FEEDBACK_STATUSES, type FeedbackStatus } from "#/shared/validator";
import { injectPrototypeShim } from "./prototype-shim";
import type { Variables } from "./types";

/**
 * Web API for the prototype subsystem (PRD 0025 / T1). Read-only on the
 * structural entities (prototype / page / version / variant). Two families of
 * mutations are exposed to the web UI, both human-driven:
 *
 *   1. Feedback (PRD 0025 / T1):
 *      - `POST /api/prototype-variants/:id/feedback` — create
 *      - `POST /api/feedbacks/:id/resolve`            — annotate
 *      - `POST /api/feedbacks/:id/ignore`             — flip to ignored
 *      - `DELETE /api/feedbacks/:id`                  — delete on latest version
 *
 *   2. Election (PRD 0028 / 0030): picking THE variant to build for a page in
 *      the current round. Distinct from `is_main` (an agent-chosen per-version
 *      primacy hint) — the human retains a variant for the dev handoff. The
 *      election now lives on the round's `(round, page)` manifest row; the web
 *      always writes the current round and clears by page id:
 *      - `POST /api/prototype-variants/:id/elect`     — elect this variant
 *      - `DELETE /api/prototype-pages/:id/election`   — clear the page's election
 *
 * `/raw` serves the variant HTML with the shim injected before `</body>`
 * and a strict CSP. Because the iframe is sandboxed without `allow-same-
 * origin`, CDN scripts that probe origin (Tailwind Play CDN) will not
 * initialise — see the template note about self-contained HTML.
 */
export const prototypesRoutes = new Hono<{ Variables: Variables }>()
  .get("/prd-revisions/:revId/prototypes", async (c) => {
    const { revId } = c.req.param();
    const prd = await getRuntime().runPromise(DomainPrds.getPrd(revId));
    if (!prd) return c.json({ error: "Not found" }, 404);
    const items = await getRuntime().runPromise(DomainPrototypes.listPrototypes(prd.id));
    return c.json({ items }, 200);
  })
  .get("/prototypes/:protoId", async (c) => {
    const { protoId } = c.req.param();
    try {
      const tree = await getRuntime().runPromise(DomainPrototypes.loadPrototypeTree(protoId));
      return c.json(tree, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .get("/prototype-variants/:variantId/raw", async (c) => {
    const { variantId } = c.req.param();
    try {
      const variant = await getRuntime().runPromise(DomainPrototypes.getVariant(variantId));
      const html = injectPrototypeShim(variant.htmlContent);
      return c.body(html, 200, {
        "content-type": "text/html; charset=utf-8",
        // The variant renders inside an iframe sandboxed WITHOUT
        // `allow-same-origin`: an opaque origin with no cookies and no access
        // to the parent DOM. That sandbox is the security boundary, so this CSP
        // is about self-containment, not script isolation. `default-src 'none'`
        // blocks every external fetch (no CDN, no beacons); `script-src
        // 'unsafe-inline' 'unsafe-eval'` lets the prototype's own inline scripts
        // run — including framework runtimes (Alpine, petite-vue) that compile
        // templates at runtime via dynamic evaluation. A nonce-only policy here
        // blocked every author script and rendered all JS-driven variants blank,
        // contradicting the `sandbox="allow-scripts"` contract. Images/fonts
        // stay limited to inlined `data:` URIs.
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; img-src data:; font-src data:`,
        "x-frame-options": "SAMEORIGIN",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .get("/prototypes/:protoId/feedbacks", async (c) => {
    const { protoId } = c.req.param();
    const statusQ = c.req.query("status");
    const variantQ = c.req.query("variant");
    if (statusQ && !VALID_FEEDBACK_STATUSES.includes(statusQ as FeedbackStatus)) {
      return c.json({ error: `Unknown status: ${statusQ}` }, 400);
    }
    try {
      const proto = await getRuntime().runPromise(DomainPrototypes.getPrototype(protoId));
      const items = await getRuntime().runPromise(
        DomainPrototypes.listFeedbacks(proto.prdRevisionId, {
          ...(statusQ ? { status: statusQ as FeedbackStatus } : {}),
          ...(variantQ ? { variantId: variantQ } : {}),
        }),
      );
      return c.json({ items }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .post("/prototype-variants/:variantId/feedback", async (c) => {
    const { variantId } = c.req.param();
    type Body = { text?: string; selectorCss?: string | null };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return c.json({ error: "text is required" }, 422);
    }
    try {
      const fb = await getRuntime().runPromise(
        DomainPrototypes.addFeedback({
          variantId,
          text: body.text,
          selectorCss: body.selectorCss ?? null,
        }),
      );
      const variant = await getRuntime().runPromise(DomainPrototypes.getVariant(fb.variantId));
      const version = await getRuntime().runPromise(
        DomainPrototypes.getVersion(variant.pageVersionId),
      );
      const page = await getRuntime().runPromise(DomainPrototypes.getPage(version.pageId));
      const proto = await getRuntime().runPromise(DomainPrototypes.getPrototype(page.prototypeId));
      const prd = await getRuntime().runPromise(DomainPrds.getPrd(proto.prdRevisionId));
      if (prd) {
        await getRuntime().runPromise(
          logActivity({
            projectId: prd.projectId,
            workspaceId: prd.workspaceId ?? undefined,
            prdRevisionId: prd.id,
            eventType: "prototype_feedback_added",
            payload: {
              feedbackId: fb.id,
              variantId: fb.variantId,
              hasPin: fb.selectorCss !== null,
            },
            source: "human",
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
        );
      }
      return c.json({ item: fb }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no longer the latest non-archived/i.test(msg)) {
        return c.json(
          {
            error: msg,
            code: "stale_version",
            hint: "Navigate to the latest version of this page to submit the feedback.",
          },
          409,
        );
      }
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .post("/feedbacks/:fbId/resolve", async (c) => {
    const { fbId } = c.req.param();
    type Body = {
      note?: string | null;
      via_variant_id?: string | null;
      viaVariantId?: string | null;
    };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    const viaVariantId = body.viaVariantId ?? body.via_variant_id ?? null;
    try {
      const updated = await getRuntime().runPromise(
        DomainPrototypes.resolveFeedback(fbId, {
          note: body.note ?? null,
          viaVariantId,
        }),
      );
      return c.json({ item: updated }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .delete("/feedbacks/:fbId", async (c) => {
    const { fbId } = c.req.param();
    try {
      const deleted = await getRuntime().runPromise(DomainPrototypes.deleteFeedback(fbId));
      const variant = await getRuntime().runPromise(DomainPrototypes.getVariant(deleted.variantId));
      const version = await getRuntime().runPromise(
        DomainPrototypes.getVersion(variant.pageVersionId),
      );
      const page = await getRuntime().runPromise(DomainPrototypes.getPage(version.pageId));
      const proto = await getRuntime().runPromise(DomainPrototypes.getPrototype(page.prototypeId));
      const prd = await getRuntime().runPromise(DomainPrds.getPrd(proto.prdRevisionId));
      if (prd) {
        await getRuntime().runPromise(
          logActivity({
            projectId: prd.projectId,
            workspaceId: prd.workspaceId ?? undefined,
            prdRevisionId: prd.id,
            eventType: "prototype_feedback_deleted",
            payload: {
              feedbackId: deleted.id,
              variantId: deleted.variantId,
              hasPin: deleted.selectorCss !== null,
            },
            source: "human",
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
        );
      }
      return c.json({ item: deleted }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/no longer the latest non-archived/i.test(msg)) {
        return c.json(
          {
            error: msg,
            code: "stale_version",
            hint: "A feedback can only be deleted while its target variant sits on the latest non-archived version of its page.",
          },
          409,
        );
      }
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .post("/feedbacks/:fbId/ignore", async (c) => {
    const { fbId } = c.req.param();
    type Body = { reason?: unknown };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
      return c.json({ error: "reason is required" }, 400);
    }
    try {
      const updated = await getRuntime().runPromise(
        DomainPrototypes.ignoreFeedback(fbId, { reason: body.reason }),
      );
      return c.json({ item: updated }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .post("/prototype-variants/:variantId/elect", async (c) => {
    const { variantId } = c.req.param();
    type Body = { rationale?: string };
    const body = (await c.req.json().catch(() => ({}))) as Body;
    // Rationale is optional from the web; the domain requires a non-empty
    // string, so default to a stable marker that records the election came from
    // the UI rather than a deliberate arbitration note.
    const rationale = body.rationale?.trim() || "Elected from the web UI";
    try {
      // Round-scoped election (PRD 0030): the web always targets the current
      // round. The domain returns the manifest row joined with its page.
      const election = await getRuntime().runPromise(
        DomainPrototypes.electVariant(variantId, { rationale, decidedBy: "web" }),
      );
      const proto = await getRuntime().runPromise(
        DomainPrototypes.getPrototype(election.page.prototypeId),
      );
      const prd = await getRuntime().runPromise(DomainPrds.getPrd(proto.prdRevisionId));
      if (prd) {
        await getRuntime().runPromise(
          logActivity({
            projectId: prd.projectId,
            workspaceId: prd.workspaceId ?? undefined,
            prdRevisionId: prd.id,
            eventType: "prototype_variant_elected",
            payload: {
              pageId: election.page.id,
              roundId: election.roundId,
              variantId,
              rationale,
              decidedBy: "web",
            },
            source: "human",
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
        );
      }
      return c.json({ item: election }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  })
  .delete("/prototype-pages/:pageId/election", async (c) => {
    const { pageId } = c.req.param();
    try {
      const election = await getRuntime().runPromise(DomainPrototypes.clearElection(pageId));
      const proto = await getRuntime().runPromise(
        DomainPrototypes.getPrototype(election.page.prototypeId),
      );
      const prd = await getRuntime().runPromise(DomainPrds.getPrd(proto.prdRevisionId));
      if (prd) {
        await getRuntime().runPromise(
          logActivity({
            projectId: prd.projectId,
            workspaceId: prd.workspaceId ?? undefined,
            prdRevisionId: prd.id,
            eventType: "prototype_variant_unelected",
            payload: { pageId: election.page.id, roundId: election.roundId },
            source: "human",
          }).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
        );
      }
      return c.json({ item: election }, 200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 422);
    }
  });
