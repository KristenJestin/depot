import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0018 / T2 — `depot context dev <prd-id>` renders the « Tâches humaines »
 * section.
 *
 * T1 wired up the schema, the `kind=human` enum extension, and the
 * `task verify` CLI. T2 layers on the agent-facing prose so the dev
 * orchestrator actually knows what to do with these tasks at runtime. The
 * piece the integration test guards is the rendering contract: when the dev
 * agent fetches its manual for a PRD that contains a human task, the manual
 * must carry the new section verbatim — section title, hand-off script, and
 * an explicit reference to the `depot task verify` CLI. A regression that
 * silently drops the section (template renamed, marker stripped, etc.) would
 * leave the agent flying blind on the hand-off; this test fails loudly in
 * that case.
 *
 * We don't unit-test the markdown itself — the templates are embedded as
 * `import ... with { type: "text" }` and rendered through the same `depot
 * context dev` code path the agent harness uses, so asserting on the CLI
 * output is the actual contract.
 */

type PrdEnvelope = { item: { id: string; status: string } };

describe("e2e: human tasks context section (PRD 0018 / T2)", () => {
  it("`depot context dev <prd-id>` includes the « Tâches humaines » section with hand-off script and verify reference", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("human-tasks-context");
      await ctx.agent.run("depot init human-tasks-context", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Human-tasks context PRD' --context 'none' --scope 'none'",
        { cwd: repo },
      );
      const prdId = prd.item.id;

      await ctx.agent.run(
        `depot task add --prd-id ${prdId} --title 'Rotate vault secret' --desc 'Rotate the secret manually in the vault UI' --criteria 'New secret is live' --effort s --kind human`,
        { cwd: repo },
      );

      const ctxResult = await ctx.agent.run(`depot context dev ${prdId}`, { cwd: repo });
      ctx.expect.exitCode(ctxResult, 0);

      ctx.expect.contains(ctxResult.stdout, "Tâches humaines");
      ctx.expect.contains(ctxResult.stdout, "Dis-moi « fait »");
      ctx.expect.contains(ctxResult.stdout, "depot task verify");
    }, "human-tasks-context — dev context renders the « Tâches humaines » section");
  });
});
