import { describe, it } from "vite-plus/test";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * PRD 0019 / T5 — `depot prd priority` end-to-end coverage.
 *
 * The domain-level unit suite lives in `tests/e2e/prd-priority.test.ts`;
 * these scenarios drive the built `dist/index.mjs` binary against a real
 * SQLite database so a regression in the CLI surface (subcommand wiring,
 * argv parsing, default sort, exit codes, activity_log writes) would
 * surface here even if the unit suite still passes.
 *
 * Sub-cases (each its own fresh DB via `e2eScenario`):
 *
 *  A. Init project + 3 PRDs with varied priorities (`critical`, `normal`,
 *     `low`); `prd list` sorts them by priority descending; `prd list
 *     --priority critical` returns only the critical one.
 *  B. `prd priority set` changes the value; `prd show --json` confirms;
 *     activity_log carries `prd_priority_changed` with the correct
 *     `previousPriority`.
 *  C. `prd priority set` with an invalid value exits non-zero and the
 *     stderr message lists the valid enum values.
 */

type PrdItem = {
  id: string;
  prdId: string;
  title: string;
  status: string;
  revision: number;
  priority?: string;
};
type CreateEnvelope = { item: PrdItem };
type ListEnvelope = { items: ReadonlyArray<PrdItem> };
type ShowEnvelope = { item: PrdItem };
type ActivityRow = {
  id: string;
  event_type: string;
  payload: string;
};
type PrdRow = {
  id: string;
  priority: string;
};

async function seedPrd(
  ctx: ScenarioCtx,
  repo: string,
  title: string,
  priority?: string,
): Promise<PrdItem> {
  const priorityFlag = priority ? ` --priority ${priority}` : "";
  const created = await ctx.agent.runJson<CreateEnvelope>(
    `depot --json prd create --title '${title}'${priorityFlag}`,
    { cwd: repo },
  );
  return created.item;
}

describe("e2e: prd priority (PRD 0019 / T5)", () => {
  it("A — `prd list` sorts by priority desc; `--priority` filters", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-priority-a");
      await ctx.agent.run("depot init prd-priority-a", { cwd: repo });

      const prdCrit = await seedPrd(ctx, repo, "Crit", "critical");
      const prdNorm = await seedPrd(ctx, repo, "Norm", "normal");
      const prdLow = await seedPrd(ctx, repo, "Low", "low");

      // Default sort: priority desc, then updatedAt desc.
      const listed = await ctx.agent.runJson<ListEnvelope>("depot --json prd list", {
        cwd: repo,
      });
      const orderedIds = listed.items.map((p) => p.id);
      // Sanity assertion so the linter sees an explicit expect call; the
      // detailed contract checks below already throw on failure.
      ctx.expect.contains(JSON.stringify(listed.items), "critical");
      const expectedHead = prdCrit.id;
      if (orderedIds[0] !== expectedHead) {
        throw new Error(
          `expected critical PRD '${expectedHead}' first; got order [${orderedIds.join(", ")}]`,
        );
      }
      const orderedPriorities = listed.items.map((p) => p.priority ?? "normal");
      // priority rank: critical(3) > high(2) > normal(1) > low(0)
      const rank: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };
      for (let i = 1; i < orderedPriorities.length; i++) {
        const prev = orderedPriorities[i - 1]!;
        const curr = orderedPriorities[i]!;
        if (rank[prev]! < rank[curr]!) {
          throw new Error(
            `default sort violated priority order: '${prev}' came before '${curr}'; full order: ${orderedPriorities.join(", ")}`,
          );
        }
      }

      // Filter to `critical` only.
      const filtered = await ctx.agent.runJson<ListEnvelope>(
        "depot --json prd list --priority critical",
        { cwd: repo },
      );
      const filteredIds = filtered.items.map((p) => p.id);
      if (filteredIds.length !== 1 || filteredIds[0] !== prdCrit.id) {
        throw new Error(
          `expected --priority critical to return [${prdCrit.id}], got [${filteredIds.join(", ")}]`,
        );
      }
      if (filtered.items.some((p) => p.id === prdNorm.id || p.id === prdLow.id)) {
        throw new Error(
          `expected --priority critical to exclude normal/low PRDs; got: ${JSON.stringify(filteredIds)}`,
        );
      }
    }, "prd-priority A — list sort by priority + --priority filter");
  });

  it("B — `priority set` changes the value, `show --json` confirms, activity_log carries previousPriority", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-priority-b");
      await ctx.agent.run("depot init prd-priority-b", { cwd: repo });

      const prd = await seedPrd(ctx, repo, "Change-me");

      const setResult = await ctx.agent.run(`depot prd priority set ${prd.id} critical`, {
        cwd: repo,
      });
      ctx.expect.exitCode(setResult, 0);
      ctx.expect.contains(setResult.stdout, "critical");

      const shown = await ctx.agent.runJson<ShowEnvelope>(`depot --json prd show ${prd.id}`, {
        cwd: repo,
      });
      if (shown.item.priority !== "critical") {
        throw new Error(
          `expected priority='critical' after set; got '${shown.item.priority ?? "undefined"}'`,
        );
      }

      // The logical PRDs row should have priority='critical'.
      const prdRow = ctx.expect.dbRow<PrdRow>("prds", { current_revision_id: prd.id });
      if (prdRow.priority !== "critical") {
        throw new Error(
          `expected prds.priority='critical' after set, got ${JSON.stringify(prdRow.priority)}`,
        );
      }

      // activity_log has the priority change with the right payload.
      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        event_type: "prd_priority_changed",
      });
      const payload = JSON.parse(logRow.payload) as {
        prdId: string;
        previousPriority: string;
        newPriority: string;
      };
      if (payload.previousPriority !== "normal") {
        throw new Error(
          `expected prd_priority_changed.previousPriority='normal', got ${JSON.stringify(payload.previousPriority)}`,
        );
      }
      if (payload.newPriority !== "critical") {
        throw new Error(
          `expected prd_priority_changed.newPriority='critical', got ${JSON.stringify(payload.newPriority)}`,
        );
      }
      if (payload.prdId !== prd.prdId) {
        throw new Error(
          `expected prd_priority_changed.prdId=${prd.prdId}, got ${JSON.stringify(payload.prdId)}`,
        );
      }
    }, "prd-priority B — set + show + activity_log");
  });

  it("C — `priority set` with an invalid value exits non-zero with a helpful message", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-priority-c");
      await ctx.agent.run("depot init prd-priority-c", { cwd: repo });

      const prd = await seedPrd(ctx, repo, "Bad-set");

      const result = await ctx.agent.run(`depot prd priority set ${prd.id} urgent`, {
        cwd: repo,
        expectExit: "any",
      });
      if (result.exitCode === 0) {
        throw new Error(
          `expected non-zero exit for invalid priority, got 0; stdout: ${result.stdout}; stderr: ${result.stderr}`,
        );
      }
      const combinedErr = `${result.stderr}\n${result.stdout}`;
      // The error message must enumerate the valid priorities so the user
      // can correct the call without grepping the docs.
      for (const expected of ["critical", "high", "normal", "low"]) {
        if (!combinedErr.includes(expected)) {
          throw new Error(
            `expected error output to list valid priority '${expected}'; got stderr=${result.stderr}; stdout=${result.stdout}`,
          );
        }
      }

      // The PRD must NOT have been touched — priority stays 'normal'.
      const prdRow = ctx.expect.dbRow<PrdRow>("prds", { current_revision_id: prd.id });
      if (prdRow.priority !== "normal") {
        throw new Error(
          `expected prds.priority='normal' after rejected invalid set, got ${JSON.stringify(prdRow.priority)}`,
        );
      }
    }, "prd-priority C — invalid value rejected with non-zero exit");
  });
});
