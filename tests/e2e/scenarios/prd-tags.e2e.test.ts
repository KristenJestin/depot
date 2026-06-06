import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0019 / T1 — `depot prd tag` end-to-end.
 *
 * Unit-level coverage lives in `tests/lib/prd-tags.test.ts`. These three
 * scenarios drive the built `dist/index.mjs` against a real SQLite DB so a
 * regression in argv parsing, the activity-log write path, or the kebab-case
 * validator would surface here even if the unit tests still pass.
 *
 * Sub-cases (each a fresh DB):
 *  A. Two PRDs, one shared tag and one PRD-specific tag. `prd list --tag <shared>`
 *     returns both PRDs; `--tag <specific>` returns just one.
 *  B. `tag add` rejects an uppercase tag with a clear stderr message and writes
 *     no row to `prd_tags`.
 *  C. `tag remove` deletes the row; `tag list <prdId>` confirms the tag is gone
 *     and a `prd_tag_removed` row lands in `activity_log`.
 */

type PrdEnvelope = { item: { id: string; title: string } };
type PrdListEnvelope = { items: ReadonlyArray<{ id: string; title: string }> };
type TagListEnvelope = { items: ReadonlyArray<string> };

describe("e2e: prd tag (PRD 0019 / T1)", () => {
  it("A — shared and specific tags filter `prd list --tag` correctly", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("tags-a");
      await ctx.agent.run("depot init tags-a", { cwd: repo });

      const prdA = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD A'", {
        cwd: repo,
      });
      const prdB = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD B'", {
        cwd: repo,
      });

      await ctx.agent.run(`depot prd tag add ${prdA.item.id} shared-theme`, { cwd: repo });
      await ctx.agent.run(`depot prd tag add ${prdB.item.id} shared-theme`, { cwd: repo });
      await ctx.agent.run(`depot prd tag add ${prdA.item.id} only-a`, { cwd: repo });

      ctx.expect.dbHas("prd_tags", { tag: "shared-theme" });
      ctx.expect.dbHas("activity_log", { event_type: "prd_tag_added" });

      const shared = await ctx.agent.runJson<PrdListEnvelope>(
        "depot --json prd list --tag shared-theme",
        { cwd: repo },
      );
      const sharedIds = new Set(shared.items.map((p) => p.id));
      if (sharedIds.size !== 2 || !sharedIds.has(prdA.item.id) || !sharedIds.has(prdB.item.id)) {
        throw new Error(
          `expected list --tag shared-theme to return both PRDs, got ${JSON.stringify(shared.items)}`,
        );
      }

      const onlyA = await ctx.agent.runJson<PrdListEnvelope>("depot --json prd list --tag only-a", {
        cwd: repo,
      });
      if (onlyA.items.length !== 1 || onlyA.items[0]?.id !== prdA.item.id) {
        throw new Error(
          `expected list --tag only-a to return only PRD A, got ${JSON.stringify(onlyA.items)}`,
        );
      }

      const allTags = await ctx.agent.runJson<TagListEnvelope>("depot --json prd tag list", {
        cwd: repo,
      });
      if (allTags.items.join(",") !== "only-a,shared-theme") {
        throw new Error(
          `expected project-level tag list to be sorted alpha, got ${JSON.stringify(allTags.items)}`,
        );
      }
    }, "prd-tags A — shared + specific filter `prd list --tag`");
  });

  it("B — `tag add` with an uppercase tag exits non-zero and inserts nothing", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("tags-b");
      await ctx.agent.run("depot init tags-b", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD B'", {
        cwd: repo,
      });

      const result = await ctx.agent.run(`depot prd tag add ${prd.item.id} BadTag`, {
        cwd: repo,
        expectExit: "any",
      });
      if (result.exitCode === 0) {
        throw new Error(
          `expected non-zero exit for uppercase tag, got 0 (stdout: ${result.stdout})`,
        );
      }
      ctx.expect.contains(result.stderr, "kebab-case");

      const tags = await ctx.agent.runJson<TagListEnvelope>(
        `depot --json prd tag list ${prd.item.id}`,
        { cwd: repo },
      );
      if (tags.items.length !== 0) {
        throw new Error(
          `expected no tags to be persisted after a rejected add, got ${JSON.stringify(tags.items)}`,
        );
      }
    }, "prd-tags B — uppercase tag rejected, nothing inserted");
  });

  it("C — `tag remove` then `tag list` confirms the tag is gone and the event is logged", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("tags-c");
      await ctx.agent.run("depot init tags-c", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>("depot --json prd create --title 'PRD C'", {
        cwd: repo,
      });

      await ctx.agent.run(`depot prd tag add ${prd.item.id} keepers`, { cwd: repo });
      await ctx.agent.run(`depot prd tag add ${prd.item.id} doomed`, { cwd: repo });
      const before = await ctx.agent.runJson<TagListEnvelope>(
        `depot --json prd tag list ${prd.item.id}`,
        { cwd: repo },
      );
      if (before.items.join(",") !== "doomed,keepers") {
        throw new Error(
          `expected pre-removal tags to be sorted alpha, got ${JSON.stringify(before.items)}`,
        );
      }

      await ctx.agent.run(`depot prd tag remove ${prd.item.id} doomed`, { cwd: repo });

      const after = await ctx.agent.runJson<TagListEnvelope>(
        `depot --json prd tag list ${prd.item.id}`,
        { cwd: repo },
      );
      if (after.items.join(",") !== "keepers") {
        throw new Error(
          `expected only 'keepers' after removal, got ${JSON.stringify(after.items)}`,
        );
      }

      ctx.expect.dbHas("activity_log", { event_type: "prd_tag_removed" });
    }, "prd-tags C — remove deletes the row and logs prd_tag_removed");
  });
});
