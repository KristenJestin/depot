import { describe, it } from "vite-plus/test";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * PRD 0019 / T2 — `depot prd depend` end-to-end coverage.
 *
 * Unit-level coverage of the DAG cycle detection and the storage shape lives
 * in `tests/lib/prd-dependencies.test.ts`. These scenarios drive the same
 * surface through the built `dist/index.mjs` binary against a real SQLite DB,
 * so a regression in argv parsing, CLI wiring, activity-log validation, or
 * the `prd list --depends-on` filter would surface here even if the unit
 * tests still pass.
 *
 * Sub-cases (each a fresh DB):
 *  A. Three PRDs, A → B and B → C; `depend list A` shows B as the direct
 *     dependency, and `prd list --depends-on B` shows A as a dependent.
 *  B. Cycle detection: A → B, B → C, then C → A is refused (exit ≠ 0, stderr
 *     mentions the cycle path) and no `prd_depends_on` row is inserted.
 *  C. Remove a dependency: `depend remove` followed by `depend list`
 *     confirms the row is gone.
 *  D. Self-dependency: `depend add A A` exits ≠ 0 with a clear message.
 */

type CreatedPrd = { item: { id: string; prdId: string; title: string } };

type PrdListPayload = {
  items: ReadonlyArray<{ id: string; prdId: string; title: string }>;
};

type DependListPayload = {
  prdId: string;
  dependencies: ReadonlyArray<{ prdId: string; title: string | null }>;
  dependents: ReadonlyArray<{ prdId: string; title: string | null }>;
};

type DependsOnRow = { prd_id: string; depends_on_prd_id: string };

async function createPrd(
  ctx: ScenarioCtx,
  repo: string,
  title: string,
): Promise<CreatedPrd["item"]> {
  const payload = await ctx.agent.runJson<CreatedPrd>(
    `depot --json prd create --title '${title}'`,
    { cwd: repo },
  );
  return payload.item;
}

describe("e2e: prd depend (PRD 0019 / T2)", () => {
  it("A — depend add chains A→B→C; list shows direct deps and `prd list --depends-on B` finds A", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-depend-a");
      await ctx.agent.run("depot init prd-depend-a", { cwd: repo });

      const a = await createPrd(ctx, repo, "PRD A");
      const b = await createPrd(ctx, repo, "PRD B");
      const c = await createPrd(ctx, repo, "PRD C");

      const addAB = await ctx.agent.run(`depot prd depend add ${a.id} ${b.id}`, { cwd: repo });
      ctx.expect.exitCode(addAB, 0);
      const addBC = await ctx.agent.run(`depot prd depend add ${b.id} ${c.id}`, { cwd: repo });
      ctx.expect.exitCode(addBC, 0);

      const listA = await ctx.agent.runJson<DependListPayload>(
        `depot --json prd depend list ${a.id}`,
        { cwd: repo },
      );
      if (listA.dependencies.length !== 1 || listA.dependencies[0]?.prdId !== b.prdId) {
        throw new Error(
          `expected A to have exactly one dependency (B=${b.prdId}), got ${JSON.stringify(listA.dependencies)}`,
        );
      }

      const listB = await ctx.agent.runJson<DependListPayload>(
        `depot --json prd depend list ${b.id}`,
        { cwd: repo },
      );
      if (listB.dependencies.length !== 1 || listB.dependencies[0]?.prdId !== c.prdId) {
        throw new Error(
          `expected B to have exactly one dependency (C=${c.prdId}), got ${JSON.stringify(listB.dependencies)}`,
        );
      }
      if (listB.dependents.length !== 1 || listB.dependents[0]?.prdId !== a.prdId) {
        throw new Error(
          `expected B to have exactly one dependent (A=${a.prdId}), got ${JSON.stringify(listB.dependents)}`,
        );
      }

      const filtered = await ctx.agent.runJson<PrdListPayload>(
        `depot --json prd list --depends-on ${b.id}`,
        { cwd: repo },
      );
      const matched = filtered.items.find((p) => p.prdId === a.prdId);
      if (!matched) {
        throw new Error(
          `expected 'prd list --depends-on ${b.id}' to include A (prdId=${a.prdId}), got ${JSON.stringify(filtered.items)}`,
        );
      }
      if (filtered.items.some((p) => p.prdId === c.prdId)) {
        throw new Error(
          `did not expect C (prdId=${c.prdId}) in --depends-on filter for B, got ${JSON.stringify(filtered.items)}`,
        );
      }
    }, "prd-depend A — chain A→B→C, list + --depends-on filter");
  });

  it("B — cycle detection refuses C→A on top of A→B→C and inserts nothing", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-depend-b");
      await ctx.agent.run("depot init prd-depend-b", { cwd: repo });

      const a = await createPrd(ctx, repo, "PRD A");
      const b = await createPrd(ctx, repo, "PRD B");
      const c = await createPrd(ctx, repo, "PRD C");

      await ctx.agent.run(`depot prd depend add ${a.id} ${b.id}`, { cwd: repo });
      await ctx.agent.run(`depot prd depend add ${b.id} ${c.id}`, { cwd: repo });

      const reject = await ctx.agent.run(`depot prd depend add ${c.id} ${a.id}`, {
        cwd: repo,
        expectExit: "any",
      });
      if (reject.exitCode === 0) {
        throw new Error(
          `expected cycle-creating dependency add to fail, got exit 0\n  stdout: ${reject.stdout}\n  stderr: ${reject.stderr}`,
        );
      }
      ctx.expect.contains(reject.stderr, "would create cycle");
      ctx.expect.contains(reject.stderr, a.prdId);
      ctx.expect.contains(reject.stderr, b.prdId);
      ctx.expect.contains(reject.stderr, c.prdId);

      const db = await import("node:sqlite");
      const path = await import("node:path");
      const dbPath = path.join(ctx.root, "depot.db");
      const handle = new db.DatabaseSync(dbPath, { readOnly: true });
      try {
        const row = handle
          .prepare("SELECT * FROM prd_depends_on WHERE prd_id = ? AND depends_on_prd_id = ?")
          .get(c.prdId, a.prdId) as DependsOnRow | undefined;
        if (row) {
          throw new Error(
            `expected no prd_depends_on row for the rejected edge (${c.prdId} → ${a.prdId}), got ${JSON.stringify(row)}`,
          );
        }
        const total = handle.prepare("SELECT COUNT(*) AS n FROM prd_depends_on").get() as
          | { n: number }
          | undefined;
        if (!total || total.n !== 2) {
          throw new Error(
            `expected exactly 2 rows in prd_depends_on after rejected cycle, got ${total?.n}`,
          );
        }
      } finally {
        handle.close();
      }
    }, "prd-depend B — cycle detection refuses C→A and writes nothing");
  });

  it("C — `depend remove` drops the edge and `depend list` reflects it", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-depend-c");
      await ctx.agent.run("depot init prd-depend-c", { cwd: repo });

      const a = await createPrd(ctx, repo, "PRD A");
      const b = await createPrd(ctx, repo, "PRD B");

      await ctx.agent.run(`depot prd depend add ${a.id} ${b.id}`, { cwd: repo });
      const before = await ctx.agent.runJson<DependListPayload>(
        `depot --json prd depend list ${a.id}`,
        { cwd: repo },
      );
      if (before.dependencies.length !== 1) {
        throw new Error(
          `pre-condition failed: expected 1 dep, got ${JSON.stringify(before.dependencies)}`,
        );
      }

      const removed = await ctx.agent.run(`depot prd depend remove ${a.id} ${b.id}`, { cwd: repo });
      ctx.expect.exitCode(removed, 0);

      const after = await ctx.agent.runJson<DependListPayload>(
        `depot --json prd depend list ${a.id}`,
        { cwd: repo },
      );
      if (after.dependencies.length !== 0) {
        throw new Error(
          `expected no dependencies after remove, got ${JSON.stringify(after.dependencies)}`,
        );
      }

      // A second remove must be a no-op (exit 0), not a hard error.
      const repeat = await ctx.agent.run(`depot prd depend remove ${a.id} ${b.id}`, { cwd: repo });
      ctx.expect.exitCode(repeat, 0);
    }, "prd-depend C — remove then list confirms drop");
  });

  it("D — self-dependency `depend add A A` exits ≠ 0 with a clear message", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("prd-depend-d");
      await ctx.agent.run("depot init prd-depend-d", { cwd: repo });

      const a = await createPrd(ctx, repo, "PRD A");

      const result = await ctx.agent.run(`depot prd depend add ${a.id} ${a.id}`, {
        cwd: repo,
        expectExit: "any",
      });
      if (result.exitCode === 0) {
        throw new Error(
          `expected self-dependency add to fail, got exit 0\n  stdout: ${result.stdout}\n  stderr: ${result.stderr}`,
        );
      }
      ctx.expect.contains(result.stderr, "cannot depend on itself");
    }, "prd-depend D — self-dep refused with clear message");
  });
});
