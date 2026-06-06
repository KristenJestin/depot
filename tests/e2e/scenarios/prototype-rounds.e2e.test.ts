import { describe, it } from "vite-plus/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { e2eScenario } from "../runtime";

/**
 * PRD 0029 / Tranche F — Prototype design rounds, end-to-end.
 *
 * Reproduces the incident the PRD was written against, in a reduced but
 * faithful form (3 pages, one dropped in the next round), against the real
 * `depot` binary:
 *
 *  - `createPrototype` auto-seeds round `v1`; `version add` auto-includes
 *    each page's first version, so v1's manifest lands at 3 pages.
 *  - `round add v2 --from v1` clones the manifest and becomes current.
 *  - dropping a page from v2 leaves v1's manifest intact (the prior round
 *    stays a coherent, consultable whole).
 *  - iterating a page in v2 advances its pin without adding a manifest entry;
 *    v1's pin for the same page is untouched.
 *  - the `prd ready` design-lock gate (PRD 0028) is round-aware (PRD 0029 /
 *    C): it blocks on the pages the *current* round ships (home + billing)
 *    and never mentions the page dropped from this round (settings).
 *  - once every shipped page elects a design and the design is distilled, the
 *    gate passes.
 *
 * The design-lock gate only runs when a real `--user-confirmed` quote is
 * present (it is skipped under `DEPOT_BYPASS_USER_CONFIRMATION=1`, which the
 * e2e env sets). So the two `prd ready` calls below override that env var off
 * and pass a verbatim quote, to actually exercise the gate.
 */

type PrdEnvelope = { item: { id: string; prdId: string; projectId: string } };
type ProtoEnvelope = { item: { id: string; slug: string } };
type PageEnvelope = { item: { id: string; slug: string } };
type VersionEnvelope = { item: { id: string; label: string } };
type VariantEnvelope = { item: { id: string; label: string; isMain: boolean } };
type RoundEnvelope = { item: { id: string; label: string } };
type RoundListEnvelope = {
  items: Array<{ id: string; label: string; pages: number; isCurrent: boolean }>;
};

const SELF_CONTAINED_HTML = "<!doctype html><html><body><p>variant</p></body></html>";
const shellArg = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

describe("e2e prototype design rounds (PRD 0029 / Tranche F)", () => {
  it("v1 auto-manifest → open v2 → drop a page → iterate → round-aware design lock → ready", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("dashboard-proto");
      await ctx.agent.run("depot init dashboard-proto", { cwd: repo });

      // 1 — PRD revision (the id `prototype create` expects is the revision id).
      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Dashboard'",
        { cwd: repo },
      );
      const prdRevisionId = prd.item.id;

      // 2 — Prototype on the revision.
      const proto = await ctx.agent.runJson<ProtoEnvelope>(
        `depot --json prd prototype create ${prdRevisionId} dashboard`,
        { cwd: repo },
      );
      const prototypeId = proto.item.id;

      // 3 — Three pages, each with a v1 version and a self-contained variant.
      const assetDir = await ctx.dir.create("proto-assets");
      const htmlPath = join(assetDir, "page.html");
      await writeFile(htmlPath, SELF_CONTAINED_HTML);

      const addPageTree = async (slug: string, title: string) => {
        const page = await ctx.agent.runJson<PageEnvelope>(
          `depot --json prd prototype page add ${prototypeId} --slug ${slug} --title '${title}'`,
          { cwd: repo },
        );
        const version = await ctx.agent.runJson<VersionEnvelope>(
          `depot --json prd prototype version add ${page.item.id} --label it1`,
          { cwd: repo },
        );
        const variant = await ctx.agent.runJson<VariantEnvelope>(
          `depot --json prd prototype variant add ${version.item.id} --label main --title '${title} main' --file ${shellArg(htmlPath)}`,
          { cwd: repo },
        );
        return { pageId: page.item.id, versionId: version.item.id, variantId: variant.item.id };
      };

      const home = await addPageTree("home", "Home");
      const settings = await addPageTree("settings", "Settings");
      const billing = await addPageTree("billing", "Billing");

      // 4 — Round v1 was auto-seeded and `version add` auto-included each
      // page's first version: the current round is v1 with a 3-page manifest.
      const afterPages = await ctx.agent.runJson<RoundListEnvelope>(
        `depot --json prd prototype round list ${prototypeId}`,
        { cwd: repo },
      );
      const v1a = afterPages.items.find((r) => r.label === "v1");
      if (!v1a) throw new Error(`expected an auto-seeded round 'v1', got ${labels(afterPages)}`);
      if (!v1a.isCurrent) throw new Error("expected v1 to be the current round after authoring");
      if (v1a.pages !== 3) {
        throw new Error(`expected v1 manifest to hold 3 pages, got ${v1a.pages}`);
      }
      const v1Id = v1a.id;

      // 5 — Open v2 by cloning v1's manifest; v2 becomes current with 3 pages.
      const v2 = await ctx.agent.runJson<RoundEnvelope>(
        `depot --json prd prototype round add ${prototypeId} --label v2 --from v1`,
        { cwd: repo },
      );
      const v2Id = v2.item.id;
      const afterOpen = await ctx.agent.runJson<RoundListEnvelope>(
        `depot --json prd prototype round list ${prototypeId}`,
        { cwd: repo },
      );
      const v2a = afterOpen.items.find((r) => r.label === "v2");
      if (!v2a) throw new Error(`expected round 'v2' after add, got ${labels(afterOpen)}`);
      if (!v2a.isCurrent) throw new Error("expected v2 to be the current round after add");
      if (v2a.pages !== 3) {
        throw new Error(`expected cloned v2 manifest to hold 3 pages, got ${v2a.pages}`);
      }

      // 6 — Drop `settings` from v2; v2 shrinks to 2 pages, v1 stays at 3
      // (the prior round is untouched → still a coherent whole).
      await ctx.agent.run(`depot prd prototype round drop ${v2Id} ${settings.pageId}`, {
        cwd: repo,
      });
      const afterDrop = await ctx.agent.runJson<RoundListEnvelope>(
        `depot --json prd prototype round list ${prototypeId}`,
        { cwd: repo },
      );
      const v2b = afterDrop.items.find((r) => r.id === v2Id)!;
      const v1b = afterDrop.items.find((r) => r.id === v1Id)!;
      if (v2b.pages !== 2) {
        throw new Error(`expected v2 to drop to 2 pages, got ${v2b.pages}`);
      }
      if (v1b.pages !== 3) {
        throw new Error(`expected v1 to stay at 3 pages after dropping from v2, got ${v1b.pages}`);
      }

      // 7 — Iterate `home` in v2: a new version + variant advances the manifest
      // pin in place. v2 stays at 2 pages (no new page), v1 stays at 3.
      const homeIt2 = await ctx.agent.runJson<VersionEnvelope>(
        `depot --json prd prototype version add ${home.pageId} --label it2`,
        { cwd: repo },
      );
      const homeIt2Variant = await ctx.agent.runJson<VariantEnvelope>(
        `depot --json prd prototype variant add ${homeIt2.item.id} --label main --title 'Home main v2' --file ${shellArg(htmlPath)}`,
        { cwd: repo },
      );
      const afterIterate = await ctx.agent.runJson<RoundListEnvelope>(
        `depot --json prd prototype round list ${prototypeId}`,
        { cwd: repo },
      );
      const v2c = afterIterate.items.find((r) => r.id === v2Id)!;
      const v1c = afterIterate.items.find((r) => r.id === v1Id)!;
      if (v2c.pages !== 2) {
        throw new Error(`expected v2 to stay at 2 pages after iterating home, got ${v2c.pages}`);
      }
      if (v1c.pages !== 3) {
        throw new Error(`expected v1 to stay at 3 pages after iterating home, got ${v1c.pages}`);
      }

      // 8 — `prd ready` design-lock gate is round-aware: blocked, and the
      // reasons cover the pages the CURRENT round (v2) ships — home and
      // billing — but never the dropped page (settings).
      const blocked = await ctx.agent.run(`depot prd ready ${prdRevisionId} --user-confirmed go`, {
        cwd: repo,
        expectExit: "any",
        env: { DEPOT_BYPASS_USER_CONFIRMATION: "0" },
      });
      if (blocked.exitCode === 0) {
        throw new Error(
          `expected 'prd ready' to be blocked by the design lock, got exit 0\n  stdout: ${blocked.stdout}`,
        );
      }
      ctx.expect.contains(blocked.stderr, "page 'home'");
      ctx.expect.contains(blocked.stderr, "page 'billing'");
      ctx.expect.notContains(blocked.stderr, "settings");

      // 9 — Converge the shipped pages: elect a design for home (its latest
      // variant) and billing, then distill EACH page's placement on the current
      // round (PRD 0030 / issue 02 — per-(round, page) placement), so the
      // round-aware gate passes.
      await ctx.agent.run(
        `depot prd prototype variant elect ${homeIt2Variant.item.id} --rationale 'clearest home layout'`,
        { cwd: repo },
      );
      await ctx.agent.run(
        `depot prd prototype variant elect ${billing.variantId} --rationale 'final billing layout'`,
        { cwd: repo },
      );
      const placementSpec = "## Regions\nHeader top, panels below.\n\n## Order\nHeader, panels.";
      await ctx.agent.run(`depot prd prototype distill ${home.pageId} --spec '${placementSpec}'`, {
        cwd: repo,
      });
      await ctx.agent.run(
        `depot prd prototype distill ${billing.pageId} --spec '${placementSpec}'`,
        { cwd: repo },
      );

      const passed = await ctx.agent.run(`depot prd ready ${prdRevisionId} --user-confirmed go`, {
        cwd: repo,
        expectExit: "any",
        env: { DEPOT_BYPASS_USER_CONFIRMATION: "0" },
      });
      if (passed.exitCode !== 0) {
        throw new Error(
          `expected 'prd ready' to pass after convergence, got exit ${passed.exitCode}\n  stderr: ${passed.stderr}`,
        );
      }
      ctx.expect.dbRow("prd_revisions", { id: prdRevisionId, status: "ready" });
    }, "prototype rounds A–F");
  }, 120_000);
});

function labels(env: RoundListEnvelope): string {
  return env.items.map((r) => r.label).join(", ");
}
