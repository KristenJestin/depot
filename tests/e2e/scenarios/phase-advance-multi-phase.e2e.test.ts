import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T1 — Phase-advance multi-phase workflow.
 *
 * A multi-phase PRD is seeded with `depot prd load` because the per-task
 * `task add --phase` path does not initialise `prd_revisions.current_phase`
 * (only the batch loader sets `currentPhase: 1` when at least one task carries
 * a phase number). Without `current_phase` set, `phaseAdvance` rejects every
 * call up-front with "no phases defined", so the scenario would be testing
 * an entirely different error branch than the one we care about here.
 *
 * Phase-advance only fires from the `review` status — it is the user-approval
 * gate. Each sub-case therefore runs the full `request-review` → review-done
 * dance before invoking `phase-advance`, so the assertions reflect the actual
 * orchestration path, not a shortcut.
 *
 * Three sub-cases, each with its own fresh DB:
 *  A. Happy path: complete phase 1, request-review, close the human review,
 *     phase-advance → status flips back to `in_progress` with currentPhase=2
 *     and an `activity_log` `phase_advanced` row links the two phases.
 *  B. Refusal: leave a phase 1 task pending, request-review, attempt
 *     phase-advance → exit≠0, stderr names the blocking task, no DB change.
 *  C. Final advance: complete phase 2 too, request-review again, advance →
 *     status=`done` and `prd_done` is recorded in activity_log.
 */

type PrdLoadPayload = {
  prd: { id: string; status: string; currentPhase: number | null };
  tasks: ReadonlyArray<{ id: string; title: string; phaseNumber: number | null }>;
};

type PrdEnvelope = { item: { id: string; status: string; currentPhase: number | null } };

const MULTI_PHASE_LOAD_JSON = JSON.stringify({
  title: "Multi-phase rollout",
  tasks: [
    {
      title: "P1 — slice A",
      description: "Implement slice A",
      doneCriteria: "Slice A green",
      effort: "s",
      phase: 1,
    },
    {
      title: "P1 — slice B",
      description: "Implement slice B",
      doneCriteria: "Slice B green",
      effort: "s",
      phase: 1,
    },
    {
      title: "P2 — slice C",
      description: "Implement slice C",
      doneCriteria: "Slice C green",
      effort: "s",
      phase: 2,
    },
  ],
});

describe("e2e phase-advance multi-phase (PRD 0016 / T1)", () => {
  it("A — happy path: phase 1 done → review done → phase-advance → currentPhase=2 + phase_advanced event", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("phase-advance-a");
      await ctx.agent.run("depot init phase-advance-a", { cwd: repo });

      const loaded = await ctx.agent.runJson<PrdLoadPayload>("depot --json prd load", {
        cwd: repo,
        input: MULTI_PHASE_LOAD_JSON,
      });
      const prdId = loaded.prd.id;
      if (loaded.prd.currentPhase !== 1) {
        throw new Error(
          `setup invariant: prd load should seed currentPhase=1, got ${loaded.prd.currentPhase}`,
        );
      }
      const phase1Tasks = loaded.tasks.filter((t) => t.phaseNumber === 1);
      if (phase1Tasks.length !== 2) {
        throw new Error(`setup invariant: expected 2 phase-1 tasks, got ${phase1Tasks.length}`);
      }

      await ctx.agent.run(`depot prd ready ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot prd activate ${prdId}`, { cwd: repo });

      for (const t of phase1Tasks) {
        await ctx.agent.run(`depot task start ${t.id}`, { cwd: repo });
        await ctx.agent.run(`depot task done ${t.id}`, { cwd: repo });
      }

      await ctx.agent.run(`depot prd request-review ${prdId}`, { cwd: repo });

      const review = await ctx.agent.runJson<{ item: { id: string; status: string } }>(
        `depot --json review start ${prdId} --type human`,
        { cwd: repo },
      );
      await ctx.agent.run(`depot review update ${review.item.id} --feedback 'phase 1 looks good'`, {
        cwd: repo,
      });
      await ctx.agent.run(`depot review done ${review.item.id}`, { cwd: repo });

      const advanced = await ctx.agent.runJson<{
        item: { status: string; currentPhase: number | null };
        advanced: boolean;
      }>(`depot --json prd phase-advance ${prdId}`, { cwd: repo });
      if (!advanced.advanced) {
        throw new Error("expected advanced=true when phase 2 still has tasks");
      }
      if (advanced.item.status !== "in_progress") {
        throw new Error(
          `expected status=in_progress after mid-PRD advance, got '${advanced.item.status}'`,
        );
      }
      if (advanced.item.currentPhase !== 2) {
        throw new Error(`expected currentPhase=2 after advance, got ${advanced.item.currentPhase}`);
      }

      ctx.expect.dbRow("prd_revisions", { id: prdId, status: "in_progress", current_phase: 2 });
      ctx.expect.dbHas("activity_log", { prd_revision_id: prdId, event_type: "phase_advanced" });
    }, "phase-advance A — happy path");
  });

  it("B — refuses to advance when a phase 1 task is still pending", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("phase-advance-b");
      await ctx.agent.run("depot init phase-advance-b", { cwd: repo });

      const loaded = await ctx.agent.runJson<PrdLoadPayload>("depot --json prd load", {
        cwd: repo,
        input: MULTI_PHASE_LOAD_JSON,
      });
      const prdId = loaded.prd.id;
      const phase1Tasks = loaded.tasks.filter((t) => t.phaseNumber === 1);

      await ctx.agent.run(`depot prd ready ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot prd activate ${prdId}`, { cwd: repo });

      // Finish only the first phase-1 task; the second one stays pending.
      const firstTask = phase1Tasks[0]!;
      await ctx.agent.run(`depot task start ${firstTask.id}`, { cwd: repo });
      await ctx.agent.run(`depot task done ${firstTask.id}`, { cwd: repo });

      await ctx.agent.run(`depot prd request-review ${prdId}`, { cwd: repo });

      const attempt = await ctx.agent.run(`depot prd phase-advance ${prdId}`, {
        cwd: repo,
        expectExit: "any",
      });
      if (attempt.exitCode === 0) {
        throw new Error(`expected non-zero exit when a phase 1 task is still pending, got 0`);
      }
      ctx.expect.contains(attempt.stderr, "Cannot advance phase");

      // PRD must stay in 'review' with currentPhase=1 — the failed advance
      // must not silently flip any state.
      ctx.expect.dbRow("prd_revisions", { id: prdId, status: "review", current_phase: 1 });
    }, "phase-advance B — refuses with open phase 1 task");
  });

  it("C — final advance closes the PRD: status=done + prd_done event", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("phase-advance-c");
      await ctx.agent.run("depot init phase-advance-c", { cwd: repo });

      const loaded = await ctx.agent.runJson<PrdLoadPayload>("depot --json prd load", {
        cwd: repo,
        input: MULTI_PHASE_LOAD_JSON,
      });
      const prdId = loaded.prd.id;
      const phase1Tasks = loaded.tasks.filter((t) => t.phaseNumber === 1);
      const phase2Tasks = loaded.tasks.filter((t) => t.phaseNumber === 2);

      await ctx.agent.run(`depot prd ready ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot prd activate ${prdId}`, { cwd: repo });

      for (const t of phase1Tasks) {
        await ctx.agent.run(`depot task start ${t.id}`, { cwd: repo });
        await ctx.agent.run(`depot task done ${t.id}`, { cwd: repo });
      }
      await ctx.agent.run(`depot prd request-review ${prdId}`, { cwd: repo });

      const review1 = await ctx.agent.runJson<{ item: { id: string } }>(
        `depot --json review start ${prdId} --type human`,
        { cwd: repo },
      );
      await ctx.agent.run(`depot review done ${review1.item.id}`, { cwd: repo });

      await ctx.agent.run(`depot prd phase-advance ${prdId}`, { cwd: repo });
      ctx.expect.dbRow("prd_revisions", { id: prdId, status: "in_progress", current_phase: 2 });

      for (const t of phase2Tasks) {
        await ctx.agent.run(`depot task start ${t.id}`, { cwd: repo });
        await ctx.agent.run(`depot task done ${t.id}`, { cwd: repo });
      }

      await ctx.agent.run(`depot prd request-review ${prdId}`, { cwd: repo });
      const review2 = await ctx.agent.runJson<{ item: { id: string } }>(
        `depot --json review start ${prdId} --type human`,
        { cwd: repo },
      );
      await ctx.agent.run(`depot review done ${review2.item.id}`, { cwd: repo });

      const final = await ctx.agent.runJson<{ item: PrdEnvelope["item"]; advanced: boolean }>(
        `depot --json prd phase-advance ${prdId}`,
        { cwd: repo },
      );
      if (final.advanced) {
        throw new Error("expected advanced=false on the final phase-advance");
      }
      if (final.item.status !== "done") {
        throw new Error(`expected status=done on final advance, got '${final.item.status}'`);
      }

      ctx.expect.dbRow("prd_revisions", { id: prdId, status: "done" });
      ctx.expect.dbHas("activity_log", { prd_revision_id: prdId, event_type: "prd_done" });
    }, "phase-advance C — final advance closes PRD");
  }, 120_000);
});
