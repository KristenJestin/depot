import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T1 — Human review Branch B (PRD 0012).
 *
 * Walks the full Branch B handoff: an in_progress PRD goes to `review`, the
 * human review row is created (draft) with feedback + several findings, the
 * review is then begun (in_progress), and the PRD is finally resumed back to
 * `in_progress`. This is the orchestration shape sketched in PRD 0012 for the
 * coder-loop ↔ human-review back-and-forth.
 *
 * Notes on CLI shape vs the issue text:
 *  - `depot review create` does NOT exist. The CLI sub-command is
 *    `depot review start`, and the runtime helper used here matches that.
 *  - `review task add` does NOT take `--effort` — its surface is
 *    `--title`, `--description`, `--doneCriteria`, plus optional
 *    `--severity` / `--axis`. We supply severities to keep the findings
 *    realistic.
 *  - `prd resume` and `prd request-review` both want `--user-confirmed`; the
 *    runtime ships `DEPOT_BYPASS_USER_CONFIRMATION=1` by default so the
 *    scenario does not need to pass it.
 */

type PrdEnvelope = { item: { id: string; status: string } };
type TaskEnvelope = { item: { id: string; status: string } };
type ReviewEnvelope = { item: { id: string; status: string; type: string } };

describe("e2e human review Branch B (PRD 0016 / T1, PRD 0012)", () => {
  it("a–f: request-review → review start (draft) → update feedback → add 2 findings → begin → prd resume", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("branch-b-app");
      await ctx.agent.run("depot init branch-b-app", { cwd: repo });

      const prd = await ctx.agent.runJson<PrdEnvelope>(
        "depot --json prd create --title 'Branch B PRD'",
        { cwd: repo },
      );
      const prdId = prd.item.id;

      const task = await ctx.agent.runJson<TaskEnvelope>(
        `depot --json task add --prdId ${prdId} --title 'Single task' --desc 'do it' --criteria 'done' --effort s`,
        { cwd: repo },
      );

      await ctx.agent.run(`depot prd ready ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot prd activate ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot task start ${task.item.id}`, { cwd: repo });
      await ctx.agent.run(`depot task done ${task.item.id}`, { cwd: repo });

      // a — request-review flips the PRD to `review`.
      await ctx.agent.run(`depot prd request-review ${prdId} --reason 'review please'`, {
        cwd: repo,
      });
      ctx.expect.dbRow("prd_revisions", { id: prdId, status: "review" });

      // b — Branch B kicks off: a human review row is created in `draft`.
      const review = await ctx.agent.runJson<ReviewEnvelope>(
        `depot --json review start ${prdId} --type human`,
        { cwd: repo },
      );
      const reviewId = review.item.id;
      if (review.item.type !== "human") {
        throw new Error(`expected review.type=human, got '${review.item.type}'`);
      }
      ctx.expect.dbRow("reviews", { id: reviewId, status: "draft", type: "human" });

      // c — `review update --feedback` records the human's note.
      await ctx.agent.run(
        `depot review update ${reviewId} --feedback 'rename foo to bar across the board'`,
        { cwd: repo },
      );
      const updated = ctx.expect.dbRow<{ user_feedback: string | null }>("reviews", {
        id: reviewId,
      });
      if (updated.user_feedback !== "rename foo to bar across the board") {
        throw new Error(
          `expected user_feedback to be set, got: ${JSON.stringify(updated.user_feedback)}`,
        );
      }

      // d — two findings added via `review task add`.
      const findings = [
        {
          title: "Rename foo to bar",
          description: "All call-sites of foo() should become bar()",
          doneCriteria: "foo no longer appears in src/",
          severity: "major",
        },
        {
          title: "Update tests for bar",
          description: "Mirror the rename in tests/",
          doneCriteria: "tests grep clean for foo",
          severity: "minor",
        },
      ] as const;
      for (const f of findings) {
        await ctx.agent.run(
          `depot review task add ${reviewId} ` +
            `--title '${f.title}' --description '${f.description}' ` +
            `--doneCriteria '${f.doneCriteria}' --severity ${f.severity} --axis human`,
          { cwd: repo },
        );
      }
      const listed = await ctx.agent.runJson<{
        items: ReadonlyArray<{ id: string; title: string; severity: string | null }>;
      }>(`depot --json review task list ${reviewId}`, { cwd: repo });
      if (listed.items.length !== 2) {
        throw new Error(`expected 2 review findings, got ${listed.items.length}`);
      }

      // e — `review begin` flips the review draft → in_progress.
      await ctx.agent.run(`depot review begin ${reviewId}`, { cwd: repo });
      ctx.expect.dbRow("reviews", { id: reviewId, status: "in_progress" });

      // f — `prd resume` brings the PRD back to in_progress so the next
      // coder pass can pick up the findings.
      await ctx.agent.run(`depot prd resume ${prdId}`, { cwd: repo });
      ctx.expect.dbRow("prd_revisions", { id: prdId, status: "in_progress" });

      // The review is still in_progress — it is the next coder pass's
      // responsibility (not this gate) to close it.
      ctx.expect.dbRow("reviews", { id: reviewId, status: "in_progress" });
    }, "branch-b a–f");
  });
});
