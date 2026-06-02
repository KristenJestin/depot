import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0024 / T2 — `depot serve` + annexes web surface.
 *
 * Spawns the CLI's HTTP server against an isolated SQLite DB and drives the
 * annex CRUD endpoints through real `fetch` calls — the same harness used by
 * `prd-groupings-web.e2e.test.ts`.
 *
 * A. Seed a PRD via the CLI; POST `/api/prds/:id/annexes` adds an html annex.
 *    GET `/api/prds/:id` lists the annex with name/kind/description but NOT its
 *    full `content`. GET `/api/prds/:id/annexes/:annexId` returns the content.
 *    DELETE removes it. Each write persists the matching activity_log row.
 */

type PrdEnvelope = { item: { id: string; prdId: string; title: string } };

function pickHighPort(): number {
  return 48000 + Math.floor(Math.random() * 1000);
}

const HTML_PROTO = "<html><body><h1>Pointage des factures</h1></body></html>";

describe("e2e: prd annexes web surface (PRD 0024 / T2)", () => {
  it("A — POST adds, GET lists (no content), GET annex returns content, DELETE removes", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("annexes-web-a");
      await ctx.agent.run("depot init annexes-web-a", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Annex web PRD'",
        { cwd: repo },
      );

      const port = pickHighPort();
      const handle = ctx.agent.spawn(`depot serve --port ${port}`, { cwd: repo });
      await handle.waitForPort(port, 5000);

      try {
        const base = `http://127.0.0.1:${port}`;

        const postRes = await fetch(`${base}/api/prds/${prd.item.id}/annexes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "pointage-factures",
            kind: "html",
            description: "prototype du pointage de factures",
            content: HTML_PROTO,
          }),
        });
        if (postRes.status !== 201) {
          throw new Error(
            `POST /annexes: expected 201, got ${postRes.status} — body: ${await postRes.text()}`,
          );
        }
        const created = (await postRes.json()) as {
          item: { id: string; name: string; kind: string; description: string | null };
        };
        if (created.item.name !== "pointage-factures" || created.item.kind !== "html") {
          throw new Error(`unexpected created annex: ${JSON.stringify(created)}`);
        }
        // The POST response is metadata only — content must not be echoed back.
        if ("content" in created.item) {
          throw new Error(`POST response leaked content: ${JSON.stringify(created.item)}`);
        }
        const annexId = created.item.id;

        ctx.expect.dbHas("prd_annexes", { name: "pointage-factures", kind: "html" });
        ctx.expect.dbHas("activity_log", { event_type: "prd_annex_added" });

        const detailRes = await fetch(`${base}/api/prds/${prd.item.id}`);
        if (detailRes.status !== 200) {
          throw new Error(
            `GET /api/prds/:id: expected 200, got ${detailRes.status} — body: ${await detailRes.text()}`,
          );
        }
        const detail = (await detailRes.json()) as {
          annexes: Array<{ id: string; name: string; kind: string; description: string | null }>;
          brokenAnnexRefs: string[];
        };
        if (
          detail.annexes.length !== 1 ||
          detail.annexes[0]?.name !== "pointage-factures" ||
          detail.annexes[0]?.kind !== "html" ||
          detail.annexes[0]?.description !== "prototype du pointage de factures"
        ) {
          throw new Error(
            `expected one html annex in detail, got ${JSON.stringify(detail.annexes)}`,
          );
        }
        // The list surface must NOT carry the full content.
        if ("content" in (detail.annexes[0] as Record<string, unknown>)) {
          throw new Error(
            `GET /api/prds/:id leaked annex content: ${JSON.stringify(detail.annexes[0])}`,
          );
        }

        const contentRes = await fetch(`${base}/api/prds/${prd.item.id}/annexes/${annexId}`);
        if (contentRes.status !== 200) {
          throw new Error(
            `GET /annexes/:id: expected 200, got ${contentRes.status} — body: ${await contentRes.text()}`,
          );
        }
        const content = (await contentRes.json()) as { annex: { content: string } };
        if (content.annex.content !== HTML_PROTO) {
          throw new Error(
            `expected exact annex content, got ${JSON.stringify(content.annex.content)}`,
          );
        }

        // A duplicate name without replace is refused.
        const dupRes = await fetch(`${base}/api/prds/${prd.item.id}/annexes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "pointage-factures", kind: "html", content: "<p>dup</p>" }),
        });
        if (dupRes.status !== 409) {
          throw new Error(
            `POST duplicate annex: expected 409, got ${dupRes.status} — body: ${await dupRes.text()}`,
          );
        }

        const delRes = await fetch(`${base}/api/prds/${prd.item.id}/annexes/${annexId}`, {
          method: "DELETE",
        });
        if (delRes.status !== 200) {
          throw new Error(
            `DELETE /annexes/:id: expected 200, got ${delRes.status} — body: ${await delRes.text()}`,
          );
        }
        ctx.expect.dbHas("activity_log", { event_type: "prd_annex_removed" });

        const afterRes = await fetch(`${base}/api/prds/${prd.item.id}`);
        const after = (await afterRes.json()) as { annexes: Array<{ id: string }> };
        if (after.annexes.length !== 0) {
          throw new Error(`expected no annexes after DELETE, got ${JSON.stringify(after.annexes)}`);
        }

        // A gone annex returns 404 on the content endpoint.
        const goneRes = await fetch(`${base}/api/prds/${prd.item.id}/annexes/${annexId}`);
        if (goneRes.status !== 404) {
          throw new Error(`GET removed annex: expected 404, got ${goneRes.status}`);
        }
      } finally {
        handle.kill();
      }
    }, "prd-annexes-web A — annex CRUD over HTTP");
  });
});
