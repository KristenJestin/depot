import { describe, it } from "vite-plus/test";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * PRD 0019 / T3 — `depot prd milestone` end-to-end coverage.
 *
 * The domain-level unit suite lives in `tests/e2e/prd-milestones.test.ts`;
 * these scenarios drive the built `dist/index.mjs` binary against a real
 * SQLite database so a regression in the CLI surface (subcommand wiring,
 * argv parsing, output formatting, exit codes, activity_log writes) would
 * surface here even if the unit suite still passes.
 *
 * Sub-cases (each its own fresh DB via `e2eScenario`):
 *
 *  A. Init project + 3 PRDs; `milestone set 2.6` on two of them; verify
 *     `prd list --milestone 2.6` returns only those two; verify
 *     `milestone summary 2.6` reports the expected per-status counts in
 *     both human and `--json` output.
 *  B. `milestone unset` on a PRD; verify `prd list --milestone 2.6` no
 *     longer contains it; verify `prd_milestone_unset` was logged with
 *     `previousVersion: "2.6"`.
 *  C. `milestone set` with an empty version exits non-zero with a clear
 *     stderr message, and the row stays untouched (`target_version` null).
 */

type PrdItem = { id: string; title: string; status: string; revision: number };
type CreateEnvelope = { item: PrdItem };
type ListEnvelope = { items: ReadonlyArray<PrdItem> };
type SummaryPayload = {
  version: string;
  total: number;
  byStatus: Record<string, number>;
};
type ActivityRow = {
  id: string;
  event_type: string;
  payload: string;
};
type PrdRow = {
  id: string;
  target_version: string | null;
};

async function seedPrd(ctx: ScenarioCtx, repo: string, title: string): Promise<PrdItem> {
  const created = await ctx.agent.runJson<CreateEnvelope>(
    `depot --json prd create --title '${title}'`,
    { cwd: repo },
  );
  return created.item;
}

describe("e2e: prd milestone (PRD 0019 / T3)", () => {
  it("A — `milestone set` on 2 of 3 PRDs is visible via `list --milestone` and `summary`", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-milestones-a");
      await ctx.agent.run("depot init prd-milestones-a", { cwd: repo });

      const prdA = await seedPrd(ctx, repo, "Alpha");
      const prdB = await seedPrd(ctx, repo, "Beta");
      const prdC = await seedPrd(ctx, repo, "Gamma");

      await ctx.agent.run(`depot prd milestone set ${prdA.id} 2.6`, { cwd: repo });
      await ctx.agent.run(`depot prd milestone set ${prdB.id} 2.6`, { cwd: repo });
      // Leave prdC unset so the filter has something to skip.

      const listed = await ctx.agent.runJson<ListEnvelope>(
        "depot --json prd list --milestone 2.6 --all",
        { cwd: repo },
      );
      const ids = listed.items.map((p) => p.id).sort();
      const want = [prdA.id, prdB.id].sort();
      if (ids.length !== want.length || ids.some((id, i) => id !== want[i])) {
        throw new Error(
          `expected prd list --milestone 2.6 to return [${want.join(", ")}], got [${ids.join(", ")}]`,
        );
      }
      const cIncluded = listed.items.find((p) => p.id === prdC.id);
      if (cIncluded) {
        throw new Error(
          `expected unmilestoned PRD ${prdC.id} to NOT appear in --milestone 2.6 listing`,
        );
      }

      // Human summary: free-form text, just spot-check the headline counts.
      const summary = await ctx.agent.run("depot prd milestone summary 2.6", { cwd: repo });
      ctx.expect.exitCode(summary, 0);
      ctx.expect.contains(summary.stdout, "Milestone '2.6'");
      ctx.expect.contains(summary.stdout, "2 PRD");
      ctx.expect.contains(summary.stdout, "draft");

      // JSON summary: stable contract callers can rely on.
      const summaryJson = await ctx.agent.runJson<SummaryPayload>(
        "depot --json prd milestone summary 2.6",
        { cwd: repo },
      );
      if (summaryJson.version !== "2.6") {
        throw new Error(`expected summary.version='2.6', got '${summaryJson.version}'`);
      }
      if (summaryJson.total !== 2) {
        throw new Error(`expected summary.total=2, got ${summaryJson.total}`);
      }
      if (summaryJson.byStatus["draft"] !== 2) {
        throw new Error(
          `expected summary.byStatus.draft=2, got ${summaryJson.byStatus["draft"]}; full payload: ${JSON.stringify(summaryJson)}`,
        );
      }
      for (const status of ["ready", "in_progress", "review", "done", "canceled"]) {
        if (summaryJson.byStatus[status] !== 0) {
          throw new Error(
            `expected summary.byStatus.${status}=0, got ${summaryJson.byStatus[status]}`,
          );
        }
      }
    }, "prd-milestones A — set + list + summary (text & json)");
  });

  it("B — `milestone unset` removes the PRD from the milestone listing and logs the event", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-milestones-b");
      await ctx.agent.run("depot init prd-milestones-b", { cwd: repo });

      const prd = await seedPrd(ctx, repo, "Unset target");
      await ctx.agent.run(`depot prd milestone set ${prd.id} 2.6`, { cwd: repo });

      const beforeList = await ctx.agent.runJson<ListEnvelope>(
        "depot --json prd list --milestone 2.6 --all",
        { cwd: repo },
      );
      if (!beforeList.items.some((p) => p.id === prd.id)) {
        throw new Error(
          `pre-condition: expected PRD ${prd.id} to be listed under 2.6 before unset`,
        );
      }

      const unsetResult = await ctx.agent.run(`depot prd milestone unset ${prd.id}`, {
        cwd: repo,
      });
      ctx.expect.exitCode(unsetResult, 0);
      ctx.expect.contains(unsetResult.stdout, "Cleared milestone");

      const afterList = await ctx.agent.runJson<ListEnvelope>(
        "depot --json prd list --milestone 2.6 --all",
        { cwd: repo },
      );
      if (afterList.items.some((p) => p.id === prd.id)) {
        throw new Error(
          `expected PRD ${prd.id} to be absent from --milestone 2.6 listing after unset, ` +
            `got: ${JSON.stringify(afterList.items.map((p) => p.id))}`,
        );
      }

      // The logical PRDs row should have target_version=NULL.
      const prdRows = ctx.expect.dbRow<PrdRow>("prds", { current_revision_id: prd.id });
      if (prdRows.target_version !== null) {
        throw new Error(
          `expected prds.target_version=NULL after unset, got ${JSON.stringify(prdRows.target_version)}`,
        );
      }

      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        event_type: "prd_milestone_unset",
      });
      const payload = JSON.parse(logRow.payload) as {
        prdId: string;
        previousVersion: string | null;
        newVersion: string | null;
      };
      if (payload.previousVersion !== "2.6") {
        throw new Error(
          `expected prd_milestone_unset.previousVersion='2.6', got ${JSON.stringify(payload.previousVersion)}`,
        );
      }
      if (payload.newVersion !== null) {
        throw new Error(
          `expected prd_milestone_unset.newVersion=null, got ${JSON.stringify(payload.newVersion)}`,
        );
      }
    }, "prd-milestones B — unset removes from listing + logs prd_milestone_unset");
  });

  it("C — `milestone set` with an empty version exits non-zero with a clear message", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-milestones-c");
      await ctx.agent.run("depot init prd-milestones-c", { cwd: repo });

      const prd = await seedPrd(ctx, repo, "Empty version");

      // Whitespace-only string survives the shell-style argv splitter (so we
      // can prove the *domain* validator rejects it, not just the Schema's
      // minLength on the positional). The CLI flag is declared
      // `Schema.minLength(1)` so the bare-empty `''` form would be dropped by
      // the splitter long before reaching the milestone validator; using a
      // quoted single space makes the case unambiguous.
      const result = await ctx.agent.run(`depot prd milestone set ${prd.id} ' '`, {
        cwd: repo,
        expectExit: "any",
      });
      if (result.exitCode === 0) {
        throw new Error(
          `expected non-zero exit for empty milestone, got 0; stdout: ${result.stdout}; stderr: ${result.stderr}`,
        );
      }
      const combinedErr = `${result.stderr}\n${result.stdout}`;
      if (!/milestone|version/i.test(combinedErr)) {
        throw new Error(
          `expected output to mention milestone/version, got stderr=${result.stderr}; stdout=${result.stdout}`,
        );
      }

      // The PRD must NOT have been touched.
      const prdRow = ctx.expect.dbRow<PrdRow>("prds", { current_revision_id: prd.id });
      if (prdRow.target_version !== null) {
        throw new Error(
          `expected prds.target_version=NULL after rejected empty-version set, got ${JSON.stringify(prdRow.target_version)}`,
        );
      }
    }, "prd-milestones C — empty version rejected with non-zero exit");
  });
});
