import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0019 / T4 — `depot serve` + groupings (tags / milestones / deps).
 *
 * Both scenarios spawn the CLI's HTTP server against an isolated SQLite DB
 * and drive it through real `fetch` calls — the same harness already used by
 * `serve-http-probes.e2e.test.ts`.
 *
 * A. Seed three PRDs (`alpha`, `beta`, `gamma`) attached to a single
 *    workspace, then via the CLI:
 *       - tag `alpha` and `beta` with `shipped`;
 *       - set `alpha`'s milestone to `2.6.1`;
 *       - depend `beta` on `alpha`.
 *    Exercise the read surface:
 *       - `GET /api/prds?tag=shipped&milestone=2.6.1` returns only `alpha`.
 *       - `GET /api/milestones/2.6.1` returns the 1-item list + the summary.
 *
 * B. Add a tag via `POST /api/prds/:id/tags` and assert the relayed
 *    `GET /api/prds/:id` sees the new tag in the `tags` array, plus the
 *    `prd_tag_added` activity-log row is persisted (proves the HTTP write
 *    path mirrors the CLI surface).
 */

type PrdEnvelope = { item: { id: string; prdId: string; title: string } };

function pickHighPort(): number {
  return 47000 + Math.floor(Math.random() * 1000);
}

describe("e2e: prd groupings web surface (PRD 0019 / T4)", () => {
  it("A — GET /api/prds?tag&milestone intersects + GET /api/milestones/<v> summary", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("groupings-a");
      await ctx.agent.run("depot init groupings-a", { cwd: repo });

      const alpha = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'PRD Alpha'",
        { cwd: repo },
      );
      const beta = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'PRD Beta'",
        { cwd: repo },
      );
      await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD Gamma'", {
        cwd: repo,
      });

      await ctx.agent.run(`depot prd tag add ${alpha.item.id} shipped`, { cwd: repo });
      await ctx.agent.run(`depot prd tag add ${beta.item.id} shipped`, { cwd: repo });
      await ctx.agent.run(`depot prd milestone set ${alpha.item.id} 2.6.1`, { cwd: repo });
      await ctx.agent.run(`depot prd depend add ${beta.item.id} ${alpha.item.id}`, {
        cwd: repo,
      });

      ctx.expect.dbHas("prd_tags", { tag: "shipped" });

      const port = pickHighPort();
      const handle = ctx.agent.spawn(`depot serve --port ${port}`, { cwd: repo });
      await handle.waitForPort(port, 5000);

      try {
        const tagAndMilestoneRes = await fetch(
          `http://127.0.0.1:${port}/api/prds?tag=shipped&milestone=2.6.1`,
        );
        if (tagAndMilestoneRes.status !== 200) {
          throw new Error(
            `expected 200, got ${tagAndMilestoneRes.status} — body: ${await tagAndMilestoneRes.text()}`,
          );
        }
        const tagAndMilestone = (await tagAndMilestoneRes.json()) as {
          prds: Array<{ id: string; tags: string[]; targetVersion: string | null }>;
        };
        if (tagAndMilestone.prds.length !== 1 || tagAndMilestone.prds[0]?.id !== alpha.item.id) {
          throw new Error(
            `expected ?tag=shipped&milestone=2.6.1 to return only alpha, got ${JSON.stringify(
              tagAndMilestone.prds.map((p) => p.id),
            )}`,
          );
        }
        if (
          !tagAndMilestone.prds[0].tags.includes("shipped") ||
          tagAndMilestone.prds[0].targetVersion !== "2.6.1"
        ) {
          throw new Error(
            `expected alpha to expose tags + targetVersion, got ${JSON.stringify(
              tagAndMilestone.prds[0],
            )}`,
          );
        }

        const tagOnlyRes = await fetch(`http://127.0.0.1:${port}/api/prds?tag=shipped`);
        const tagOnly = (await tagOnlyRes.json()) as { prds: Array<{ id: string }> };
        const tagOnlyIds = new Set(tagOnly.prds.map((p) => p.id));
        if (
          tagOnlyIds.size !== 2 ||
          !tagOnlyIds.has(alpha.item.id) ||
          !tagOnlyIds.has(beta.item.id)
        ) {
          throw new Error(
            `expected ?tag=shipped to return alpha+beta, got ${JSON.stringify([...tagOnlyIds])}`,
          );
        }

        const dependsOnRes = await fetch(
          `http://127.0.0.1:${port}/api/prds?dependsOn=${alpha.item.id}`,
        );
        const dependsOn = (await dependsOnRes.json()) as { prds: Array<{ id: string }> };
        if (dependsOn.prds.length !== 1 || dependsOn.prds[0]?.id !== beta.item.id) {
          throw new Error(
            `expected ?dependsOn=alpha to return beta, got ${JSON.stringify(
              dependsOn.prds.map((p) => p.id),
            )}`,
          );
        }

        const milestoneRes = await fetch(`http://127.0.0.1:${port}/api/milestones/2.6.1`);
        if (milestoneRes.status !== 200) {
          throw new Error(
            `GET /api/milestones/2.6.1: expected 200, got ${milestoneRes.status} — body: ${await milestoneRes.text()}`,
          );
        }
        const milestone = (await milestoneRes.json()) as {
          items: Array<{ id: string; title: string; status: string }>;
          summary: {
            version: string;
            total: number;
            byStatus: Record<string, number>;
          };
        };
        if (milestone.summary.version !== "2.6.1" || milestone.summary.total !== 1) {
          throw new Error(
            `expected summary { version: '2.6.1', total: 1 }, got ${JSON.stringify(
              milestone.summary,
            )}`,
          );
        }
        if (milestone.items.length !== 1 || milestone.items[0]?.id !== alpha.item.id) {
          throw new Error(
            `expected milestone items to be [alpha], got ${JSON.stringify(milestone.items)}`,
          );
        }
      } finally {
        handle.kill();
      }
    }, "prd-groupings-web A — GET /api/prds + /milestones");
  });

  it("B — POST /api/prds/:id/tags persists + GET /api/prds/:id reflects the new tag", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("groupings-b");
      await ctx.agent.run("depot init groupings-b", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'POST tag PRD'",
        { cwd: repo },
      );

      const port = pickHighPort();
      const handle = ctx.agent.spawn(`depot serve --port ${port}`, { cwd: repo });
      await handle.waitForPort(port, 5000);

      try {
        const postRes = await fetch(`http://127.0.0.1:${port}/api/prds/${prd.item.id}/tags`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag: "post-tag" }),
        });
        if (postRes.status !== 201) {
          throw new Error(
            `POST /tags: expected 201, got ${postRes.status} — body: ${await postRes.text()}`,
          );
        }
        const created = (await postRes.json()) as { item: { prdId: string; tag: string } };
        if (created.item.tag !== "post-tag") {
          throw new Error(`expected created.item.tag='post-tag', got ${JSON.stringify(created)}`);
        }

        const getRes = await fetch(`http://127.0.0.1:${port}/api/prds/${prd.item.id}`);
        if (getRes.status !== 200) {
          throw new Error(
            `GET /api/prds/:id: expected 200, got ${getRes.status} — body: ${await getRes.text()}`,
          );
        }
        const detail = (await getRes.json()) as { tags: string[] };
        if (!detail.tags.includes("post-tag")) {
          throw new Error(
            `expected detail.tags to include 'post-tag', got ${JSON.stringify(detail.tags)}`,
          );
        }

        // Persisted activity-log row mirrors the CLI surface.
        ctx.expect.dbHas("activity_log", { event_type: "prd_tag_added" });
        ctx.expect.dbHas("prd_tags", { tag: "post-tag" });

        // The DELETE counterpart also flows through to the DB.
        const delRes = await fetch(
          `http://127.0.0.1:${port}/api/prds/${prd.item.id}/tags/post-tag`,
          { method: "DELETE" },
        );
        if (delRes.status !== 200) {
          throw new Error(
            `DELETE /tags: expected 200, got ${delRes.status} — body: ${await delRes.text()}`,
          );
        }
        const after = (await (
          await fetch(`http://127.0.0.1:${port}/api/prds/${prd.item.id}`)
        ).json()) as { tags: string[] };
        if (after.tags.includes("post-tag")) {
          throw new Error(
            `expected 'post-tag' to be removed after DELETE, got ${JSON.stringify(after.tags)}`,
          );
        }
        ctx.expect.dbHas("activity_log", { event_type: "prd_tag_removed" });
      } finally {
        handle.kill();
      }
    }, "prd-groupings-web B — POST /tags → GET sees it");
  });
});
