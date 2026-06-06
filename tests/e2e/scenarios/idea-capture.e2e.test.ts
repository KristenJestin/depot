import { describe, it, expect } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0027 — Idea capture (pre-commitment backlog) E2E.
 *
 * Exercises the full idea-capture flow against a real `depot` binary built by
 * the test harness, mirroring `prd-prototype.e2e.test.ts`. The agent runs the
 * built CLI (`node --env-file-if-exists=<scenario>/.env dist/index.mjs …`) with
 * an isolated `DEPOT_DB_PATH` per scenario, so this hits the real shipped
 * surface end-to-end. The happy path:
 *
 *  - capture two ideas (one via `--body`, one via `--body-file -` stdin) with a
 *    shared `--tag`;
 *  - `idea list --json` shows both, `openCount === 2`;
 *  - create a draft PRD, link an idea (`prd idea add`) — `prd idea list` shows
 *    it, and linking does NOT change the idea status (still open);
 *  - `context prd <prdId>` carries the `Ideas   : N open` recall row AND a
 *    `## Source ideas` section with the linked idea's body; `context dev`
 *    carries NEITHER (no leak into the implementation context);
 *  - `idea promote <id>` mints a draft PRD, flips the idea to `promoted`, and
 *    drops it from the open backlog (`openCount` decreases by one);
 *  - `idea drop` + `idea reopen` round-trip on the remaining open idea.
 *
 * `prd create` returns the *revision* row: `item.id` is the revision id and
 * `item.prdId` is the logical PRD id. `prd idea add` / `context prd` both
 * accept either id (they resolve to the logical PRD), so we drive them with the
 * revision id to mirror how the prototype scenario passes `revId` around.
 */

type PrdEnvelope = { item: { id: string; prdId: string; projectId: string } };
type IdeaEnvelope = {
  item: {
    id: string;
    title: string;
    status: string;
    tag: string | null;
    body: string | null;
    promotedPrdId: string | null;
  };
};
type IdeaListEnvelope = {
  items: ReadonlyArray<{ id: string; title: string; status: string; tag: string | null }>;
  openCount: number;
};
type PrdIdeaListEnvelope = {
  items: ReadonlyArray<{ id: string; title: string; status: string }>;
};
type PromoteEnvelope = {
  idea: { id: string; status: string; promotedPrdId: string | null };
  prd: { id: string; prdId: string; title: string; status: string };
};

describe("e2e idea capture workflow (PRD 0027)", () => {
  it("full flow: capture → link (no consume) → context surfacing → promote → drop/reopen", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("idea-flow");
      await ctx.agent.run("depot init idea-flow", { cwd: repo });

      // 1. Capture two ideas under a shared tag: one body inline, one from stdin.
      const ideaA = await ctx.agent.runJson<IdeaEnvelope>(
        "depot --json idea add 'Offline sync mode' --body 'Queue writes while disconnected and reconcile on reconnect.' --tag sync",
        { cwd: repo },
      );
      expect(ideaA.item.status).toBe("open");
      expect(ideaA.item.tag).toBe("sync");

      const ideaB = await ctx.agent.runJson<IdeaEnvelope>(
        "depot --json idea add 'Conflict resolution UI' --body-file - --tag sync",
        { cwd: repo, input: "Let the user pick a winner when two edits collide.\n" },
      );
      expect(ideaB.item.status).toBe("open");
      expect(ideaB.item.body).toContain("pick a winner");

      // 2. `idea list --json` shows both, newest-first, openCount === 2.
      const listed = await ctx.agent.runJson<IdeaListEnvelope>("depot --json idea list", {
        cwd: repo,
      });
      expect(listed.openCount).toBe(2);
      expect(listed.items.map((i) => i.id).sort()).toEqual([ideaA.item.id, ideaB.item.id].sort());
      expect(listed.items.every((i) => i.status === "open")).toBe(true);

      // Text footer mirrors the JSON count.
      const listText = await ctx.agent.run("depot idea list", { cwd: repo });
      ctx.expect.contains(listText.stdout, "2 open");

      // Tag filter narrows to the shared tag (both ideas carry `sync`).
      const byTag = await ctx.agent.runJson<IdeaListEnvelope>("depot --json idea list --tag sync", {
        cwd: repo,
      });
      expect(byTag.items).toHaveLength(2);

      // 3. Create a draft PRD and link idea A as source material.
      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Sync engine'",
        { cwd: repo },
      );
      const revId = prd.item.id;

      await ctx.agent.run(`depot prd idea add ${revId} ${ideaA.item.id}`, { cwd: repo });

      const linked = await ctx.agent.runJson<PrdIdeaListEnvelope>(
        `depot --json prd idea list ${revId}`,
        { cwd: repo },
      );
      expect(linked.items.map((i) => i.id)).toEqual([ideaA.item.id]);

      // Linking is purely additive: the idea stays `open` (referencing ≠ consuming).
      const afterLink = await ctx.agent.runJson<IdeaEnvelope>(
        `depot --json idea show ${ideaA.item.id}`,
        { cwd: repo },
      );
      expect(afterLink.item.status).toBe("open");
      ctx.expect.dbRow("ideas", { id: ideaA.item.id, status: "open" });
      // Still two open ideas after linking.
      const afterLinkList = await ctx.agent.runJson<IdeaListEnvelope>("depot --json idea list", {
        cwd: repo,
      });
      expect(afterLinkList.openCount).toBe(2);

      // 4. `context prd` surfaces the recall row AND the linked source idea body.
      const prdCtx = await ctx.agent.run(`depot context prd ${revId}`, { cwd: repo });
      ctx.expect.contains(prdCtx.stdout, "Ideas   : 2 open");
      ctx.expect.contains(prdCtx.stdout, "## Source ideas");
      ctx.expect.contains(prdCtx.stdout, "Offline sync mode");
      ctx.expect.contains(prdCtx.stdout, "reconcile on reconnect");

      // `context dev` must NOT leak the recall row or the source-idea section.
      const devCtx = await ctx.agent.run(`depot context dev ${revId}`, { cwd: repo });
      ctx.expect.notContains(devCtx.stdout, "## Source ideas");
      ctx.expect.notContains(devCtx.stdout, "Offline sync mode");
      ctx.expect.notContains(devCtx.stdout, "Ideas   :");

      // 5. Promote idea B → a fresh draft PRD; the idea flips to `promoted`.
      const promoted = await ctx.agent.runJson<PromoteEnvelope>(
        `depot --json idea promote ${ideaB.item.id}`,
        { cwd: repo },
      );
      expect(promoted.idea.status).toBe("promoted");
      expect(promoted.prd.status).toBe("draft");
      expect(promoted.prd.title).toBe("Conflict resolution UI");
      // promotedPrdId is the LOGICAL PRD id (prd.prdId), not the revision id.
      expect(promoted.idea.promotedPrdId).toBe(promoted.prd.prdId);
      expect(promoted.prd.prdId).not.toBe(promoted.prd.id);

      // The promoted idea drops out of the open backlog → openCount falls to 1.
      const afterPromote = await ctx.agent.runJson<IdeaListEnvelope>("depot --json idea list", {
        cwd: repo,
      });
      expect(afterPromote.openCount).toBe(1);
      expect(afterPromote.items.map((i) => i.id)).toEqual([ideaA.item.id]);

      // A new draft PRD now exists; the promoted idea row reflects it.
      ctx.expect.dbRow("ideas", {
        id: ideaB.item.id,
        status: "promoted",
        promoted_prd_id: promoted.prd.prdId,
      });
      ctx.expect.dbRow("prd_revisions", { id: promoted.prd.id, status: "draft" });
      // And the promotion auto-linked the idea as source material on the new PRD.
      const promotedSources = await ctx.agent.runJson<PrdIdeaListEnvelope>(
        `depot --json prd idea list ${promoted.prd.id}`,
        { cwd: repo },
      );
      expect(promotedSources.items.map((i) => i.id)).toEqual([ideaB.item.id]);

      // Promote is the only happy path: re-promoting a non-open idea is rejected.
      const repromote = await ctx.agent.run(`depot idea promote ${ideaB.item.id}`, {
        cwd: repo,
        expectExit: "any",
      });
      expect(repromote.exitCode).not.toBe(0);

      // 6. drop → reopen round-trip on the remaining open idea.
      await ctx.agent.run(`depot idea drop ${ideaA.item.id} --reason 'parking for now'`, {
        cwd: repo,
      });
      ctx.expect.dbRow("ideas", { id: ideaA.item.id, status: "dropped" });
      const afterDrop = await ctx.agent.runJson<IdeaListEnvelope>("depot --json idea list", {
        cwd: repo,
      });
      expect(afterDrop.openCount).toBe(0);

      const dropped = await ctx.agent.runJson<IdeaListEnvelope>(
        "depot --json idea list --status dropped",
        { cwd: repo },
      );
      expect(dropped.items.map((i) => i.id)).toEqual([ideaA.item.id]);

      await ctx.agent.run(`depot idea reopen ${ideaA.item.id}`, { cwd: repo });
      ctx.expect.dbRow("ideas", { id: ideaA.item.id, status: "open" });
      const afterReopen = await ctx.agent.runJson<IdeaListEnvelope>("depot --json idea list", {
        cwd: repo,
      });
      expect(afterReopen.openCount).toBe(1);
      expect(afterReopen.items.map((i) => i.id)).toEqual([ideaA.item.id]);
    }, "idea capture full flow");
  }, 120_000);
});
