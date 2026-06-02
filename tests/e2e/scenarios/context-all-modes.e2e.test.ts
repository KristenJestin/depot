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

  // PRD 0023 / T3 — the rendered ship and doc contexts must carry the
  // post-merge doc-sync range guidance: pass the squash range explicitly,
  // lean on `docSyncTicketPattern` if configured, never expect a magic
  // fallback window. Anchored on the explicit `--since <squash>^ --until`
  // example, which passes through the renderer verbatim (it lives inside a
  // fenced code block).
  it("renders the explicit doc-sync range guidance in ship and doc contexts", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("ctx-doc-sync-range");
      await ctx.agent.run("depot init ctx-doc-sync-range", { cwd: repo });

      for (const mode of ["ship", "doc"]) {
        const result = await ctx.agent.run(`depot context ${mode}`, { cwd: repo });
        ctx.expect.exitCode(result, 0);
        ctx.expect.contains(
          result.stdout,
          "depot doc sync <profile> --since <squash>^ --until <squash>",
        );
        ctx.expect.contains(result.stdout, "docSyncTicketPattern");
        ctx.expect.contains(result.stdout, "never falls back to a magic window");
      }
    }, "context doc-sync range guidance (ship, doc)");
  });

  // PRD 0024 / T3 — the rendered prd context carries the annex authoring
  // guidance (when to create one, the `annex add` command, the
  // `[annex: <name>]` inline reference convention); the dev and coder
  // contexts tell the agent to `annex cat` on demand rather than auto-read.
  it("renders the annex authoring + on-demand reading guidance (prd, dev, coder)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("ctx-annexes");
      await ctx.agent.run("depot init ctx-annexes", { cwd: repo });

      const prd = await ctx.agent.run("depot context prd", { cwd: repo });
      ctx.expect.exitCode(prd, 0);
      ctx.expect.contains(prd.stdout, "loses value when flattened to prose");
      ctx.expect.contains(
        prd.stdout,
        "depot prd annex add <prd-id> --name <name> --kind <html|markdown|code|text>",
      );
      ctx.expect.contains(prd.stdout, "[annex: <name>]");

      for (const mode of ["dev", "coder"]) {
        const result = await ctx.agent.run(`depot context ${mode}`, { cwd: repo });
        ctx.expect.exitCode(result, 0);
        ctx.expect.contains(result.stdout, "depot prd annex cat <annex-id>");
        ctx.expect.contains(result.stdout, "Do not auto-read every annex");
      }
    }, "context annex guidance (prd, dev, coder)");
  });
});
