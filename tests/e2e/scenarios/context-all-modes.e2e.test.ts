import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T2 — `depot context` × 6 modes.
 *
 * For each supported mode (`prd`, `dev`, `coder`, `auditor`, `doc`, `ship`)
 * we assert that `depot context <mode>` exits 0 and prints a fragment that
 * uniquely identifies the matching template under
 * `src/modules/context/templates/<mode>.md`. The auditor mode requires
 * `--axis`, so we pass `standards` (the dev orchestrator spawns one
 * auditor per axis — both `standards` and `spec` go through the same
 * template). The dev mode is exercised twice: once without a PRD (the
 * orchestrator manual is emitted standalone), and once with a PRD id
 * passed in via the second positional argument — the latter catches a
 * regression where the PRD header would silently drop the id.
 *
 * The test guards the contract « one mode = one identifiable template »,
 * so any future refactor that swaps two templates by mistake or wipes
 * out a characteristic heading breaks here loudly.
 */

type CreatedPrd = { item: { id: string; prdId: string } };

describe("e2e: depot context × 6 modes (PRD 0016 / T2)", () => {
  it("renders the expected fragment for every mode", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("ctx-modes");
      await ctx.agent.run("depot init ctx-modes", { cwd: repo });

      // Create a PRD so the modes that hydrate per-PRD context (dev, ship)
      // can resolve a real id rather than degrading to a placeholder line.
      const created = await ctx.agent.runJson<CreatedPrd>(
        "depot --json prd create --title 'Ctx-modes PRD'",
        { cwd: repo },
      );
      const prdId = created.item.id;

      const cases: Array<{ cmd: string; label: string; fragment: string }> = [
        {
          cmd: "depot context prd",
          label: "prd",
          fragment: "PRD Agent",
        },
        {
          cmd: "depot context dev",
          label: "dev",
          fragment: "Dev Orchestrator",
        },
        {
          cmd: `depot context dev ${prdId}`,
          label: "dev (with PRD id)",
          fragment: "Branch A",
        },
        {
          cmd: "depot context coder",
          label: "coder",
          fragment: "Coder Agent",
        },
        {
          cmd: "depot context auditor --axis standards",
          label: "auditor",
          fragment: "Auditor Agent",
        },
        {
          cmd: "depot context doc",
          label: "doc",
          fragment: "Doc Agent",
        },
        {
          cmd: "depot context ship",
          label: "ship",
          fragment: "Ship Agent",
        },
      ];

      for (const c of cases) {
        const result = await ctx.agent.run(c.cmd, { cwd: repo });
        ctx.expect.exitCode(result, 0);
        ctx.expect.contains(result.stdout, c.fragment);
      }
    }, "context all modes (prd, dev, coder, auditor, doc, ship)");
  });
});
