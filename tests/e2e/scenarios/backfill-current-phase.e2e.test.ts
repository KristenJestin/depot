import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0017 / T4c — Backfill `prd_revisions.current_phase`.
 *
 * The migration `20260528000000_backfill_current_phase` retro-fits the value
 * on legacy PRDs that have phased tasks but `current_phase = NULL`. We can't
 * easily seed an older schema and let depot re-apply every migration (the
 * up-migration robustness scenario already covers that path), so this
 * scenario:
 *
 *   1. Lets depot create a fresh DB (runs every migration).
 *   2. Drops the broken state in place via raw SQL: `current_phase = NULL`
 *      on a PRD that has phased tasks (some done, some pending).
 *   3. Removes the backfill row from `__drizzle_migrations` so depot's next
 *      `applyMigrations()` re-runs the backfill on top of the broken state.
 *   4. Runs any depot command to trigger migration application + asserts
 *      `current_phase` is now set per the rule (min pending phase first).
 */

type PrdEnvelope = {
  item: { id: string; currentPhase: number | null; status: string };
};

type TaskEnvelope = { item: { id: string } };

const BACKFILL_MIGRATION_NAME = "20260528000000_backfill_current_phase";

describe("e2e backfill current_phase migration (PRD 0017 / T4c)", () => {
  it("re-applying the backfill migration heals a stuck PRD (currentPhase=NULL → 2)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("backfill-current-phase");
      await ctx.agent.run("depot init backfill-current-phase", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Stuck PRD'",
        { cwd: repo },
      );
      const prdId = prd.item.id;

      const task1 = await ctx.agent.runJson<TaskEnvelope>(
        `depot --json task add --prd-id ${prdId} --title 'P1' --desc 'd' --criteria 'd' --effort s --phase 1`,
        { cwd: repo },
      );
      await ctx.agent.run(
        `depot task add --prd-id ${prdId} --title 'P2' --desc 'd' --criteria 'd' --effort s --phase 2`,
        { cwd: repo },
      );
      await ctx.agent.run(
        `depot task add --prd-id ${prdId} --title 'P3' --desc 'd' --criteria 'd' --effort s --phase 3`,
        { cwd: repo },
      );

      await ctx.agent.run(`depot prd ready ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot prd activate ${prdId}`, { cwd: repo });

      // Mark phase 1 as done so the backfill should land on phase 2 (the
      // first non-done phase). Use `task start` then `task done` to follow
      // the normal lifecycle.
      await ctx.agent.run(`depot task start ${task1.item.id}`, { cwd: repo });
      await ctx.agent.run(`depot task done ${task1.item.id}`, { cwd: repo });

      const dbPath = path.join(ctx.root, "depot.db");

      // Force the broken state + delete the backfill migration row so depot's
      // next open re-applies the migration. The migration is idempotent and
      // guarded by `WHERE current_phase IS NULL`, so we set it back to NULL
      // explicitly to make this end-to-end provable.
      {
        const db = new DatabaseSync(dbPath);
        try {
          db.prepare(`UPDATE prd_revisions SET current_phase = NULL WHERE id = ?`).run(prdId);
          db.prepare(`DELETE FROM __drizzle_migrations WHERE name = ?`).run(
            BACKFILL_MIGRATION_NAME,
          );
        } finally {
          db.close();
        }
      }

      // Sanity: the PRD is in the broken state right now.
      ctx.expect.dbRow("prd_revisions", { id: prdId, current_phase: null });

      // Any depot command opens the DB, which triggers migration application
      // and re-runs the backfill. `prd show --json` is the cheapest read.
      await ctx.agent.run(`depot --json prd show ${prdId}`, { cwd: repo });

      // currentPhase should now be 2 (first non-done phase: 1 is done, 2 and
      // 3 are pending).
      ctx.expect.dbRow("prd_revisions", { id: prdId, current_phase: 2 });
    }, "backfill current_phase migration");
  });
});
