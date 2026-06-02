import { describe, it } from "vite-plus/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * PRD 0018 / T1 — Human tasks end-to-end.
 *
 * Unit-level coverage of `verifyTask` lives in `tests/lib/workflow.test.ts`.
 * These scenarios exercise the full CLI path through `dist/index.mjs` against
 * a real SQLite DB, so a regression in argv parsing, the `--user-confirmed`
 * gate, the execFile shim, or the `task_verified_human` payload would
 * surface here even if the unit tests still pass.
 *
 * The agent harness sets `DEPOT_BYPASS_USER_CONFIRMATION=1` by default
 * (see `tests/e2e/runtime/agent.ts`). Scenario A explicitly turns the bypass
 * off via `env: { DEPOT_BYPASS_USER_CONFIRMATION: "" }` so it can assert the
 * "missing --user-confirmed" rejection path. The other scenarios rely on the
 * default bypass — they assert the happy paths instead.
 *
 * Sub-cases (each a fresh DB):
 *  A. `task verify` without `--user-confirmed` and without the bypass env →
 *     exit 1, the task stays `pending`.
 *  B. `task verify --user-confirmed "<quote>"` on an ack-only human task →
 *     exit 0, task done, `activity_log.task_verified_human` carries the
 *     verbatim quote.
 *  C. Human task with a `verification` command that checks a tmp sentinel:
 *     first verify (no sentinel) fails (exit ≠ 0, task pending, stderr
 *     captured in the payload), then we create the file and re-verify (exit
 *     0, task done).
 *  D. `phase-advance` refuses while the human task is pending, then accepts
 *     once it has been verified.
 */

type TaskPayload = {
  item: { id: string; title: string; status: string; kind: string; position: number };
};

type PrdLoadPayload = {
  prd: { id: string; status: string; currentPhase: number | null };
  tasks: ReadonlyArray<{ id: string; title: string; phaseNumber: number | null }>;
};

type PrdEnvelope = { item: { id: string; status: string } };

type TaskRow = {
  id: string;
  status: string;
  kind: string;
  verification_command: string | null;
};

type ActivityRow = {
  id: string;
  event_type: string;
  payload: string;
};

async function bootstrapPrd(
  ctx: ScenarioCtx,
  repo: string,
  prdTitle: string,
): Promise<{ prdId: string }> {
  await ctx.agent.run(`depot init ${prdTitle}`, { cwd: repo });
  const prd = await ctx.agent.runJson<PrdEnvelope>(
    `depot --json prd create --title '${prdTitle}' --context 'none' --scope 'none'`,
    { cwd: repo },
  );
  return { prdId: prd.item.id };
}

describe("e2e: human tasks (PRD 0018 / T1)", () => {
  it("A — `task verify` without --user-confirmed and without the bypass env exits 1; task stays pending", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("human-tasks-a");
      const { prdId } = await bootstrapPrd(ctx, repo, "human-tasks-a");

      const added = await ctx.agent.runJson<TaskPayload>(
        `depot --json task add --prd-id ${prdId} --title 'Rotate vault secret' --desc 'Rotate the secret in Vault' --criteria 'New secret is live' --effort s --kind human`,
        { cwd: repo },
      );
      ctx.expect.contains(added.item.kind, "human");

      const result = await ctx.agent.run(`depot task verify ${added.item.id}`, {
        cwd: repo,
        expectExit: "any",
        env: { DEPOT_BYPASS_USER_CONFIRMATION: "" },
      });
      ctx.expect.exitCode(result, 1);
      ctx.expect.contains(result.stderr, "--user-confirmed");

      const row = ctx.expect.dbRow<TaskRow>("tasks", { id: added.item.id });
      if (row.status !== "pending") {
        throw new Error(
          `expected task to stay 'pending' after rejected verify, got '${row.status}'`,
        );
      }
    }, "human-tasks A — verify without --user-confirmed exits 1, task pending");
  });

  it("B — `task verify --user-confirmed` on an ack-only human task: exit 0, task done, payload carries the quote", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("human-tasks-b");
      const { prdId } = await bootstrapPrd(ctx, repo, "human-tasks-b");

      const added = await ctx.agent.runJson<TaskPayload>(
        `depot --json task add --prd-id ${prdId} --title 'Ack DPA receipt' --desc 'Wait for customer ack' --criteria 'Customer acked' --effort s --kind human`,
        { cwd: repo },
      );

      const verifyResult = await ctx.agent.run(
        `depot task verify ${added.item.id} --user-confirmed 'fait, customer a bien recu'`,
        { cwd: repo },
      );
      ctx.expect.exitCode(verifyResult, 0);
      ctx.expect.contains(verifyResult.stdout, "done");

      const row = ctx.expect.dbRow<TaskRow>("tasks", { id: added.item.id });
      if (row.status !== "done") {
        throw new Error(`expected task status='done' after verify, got '${row.status}'`);
      }

      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        event_type: "task_verified_human",
        task_id: added.item.id,
      });
      const payload = JSON.parse(logRow.payload) as {
        taskId: string;
        userConfirmation: string | null;
        verificationExitCode?: number;
      };
      if (payload.taskId !== added.item.id) {
        throw new Error(`expected payload.taskId=${added.item.id}, got ${payload.taskId}`);
      }
      if (payload.userConfirmation !== "fait, customer a bien recu") {
        throw new Error(
          `expected payload.userConfirmation to carry the verbatim quote, got ${JSON.stringify(payload.userConfirmation)}`,
        );
      }
      if (payload.verificationExitCode !== undefined) {
        throw new Error(
          `expected no verificationExitCode for an ack-only verify, got ${payload.verificationExitCode}`,
        );
      }
    }, "human-tasks B — ack-only verify marks done and logs the quote");
  });

  it("C — verification command fails then passes: first verify keeps task pending with stderr, second verify marks done", async () => {
    const sentinelDir = mkdtempSync(path.join(tmpdir(), "depot-human-tasks-c-"));
    const sentinel = path.join(sentinelDir, "sentinel");
    const normalizedSentinel = sentinel.replace(/\\/g, "/");
    const verificationCommand =
      process.platform === "win32"
        ? `node -e process.exit(require("node:fs").existsSync("${normalizedSentinel}")?0:1)`
        : `test -f "${sentinel}"`;
    try {
      await e2eScenario(async (ctx) => {
        const repo = await ctx.git.initRepo("human-tasks-c");
        const { prdId } = await bootstrapPrd(ctx, repo, "human-tasks-c");

        const added = await ctx.agent.runJson<TaskPayload>(
          `depot --json task add --prd-id ${prdId} --title 'Touch sentinel' --desc 'Create the sentinel file' --criteria 'Sentinel exists' --effort s --kind human --verification '${verificationCommand}'`,
          { cwd: repo },
        );

        const firstAttempt = await ctx.agent.run(
          `depot task verify ${added.item.id} --user-confirmed 'cest fait je crois'`,
          { cwd: repo, expectExit: "any" },
        );
        ctx.expect.exitCode(firstAttempt, 1);
        ctx.expect.contains(firstAttempt.stderr, "Verification command");

        const rowAfterFail = ctx.expect.dbRow<TaskRow>("tasks", { id: added.item.id });
        if (rowAfterFail.status !== "pending") {
          throw new Error(
            `expected task to stay 'pending' after failing verify, got '${rowAfterFail.status}'`,
          );
        }

        const failureLog = ctx.expect.dbRow<ActivityRow>("activity_log", {
          event_type: "task_verified_human",
          task_id: added.item.id,
        });
        const failurePayload = JSON.parse(failureLog.payload) as {
          verificationExitCode?: number;
          verificationStderr?: string;
        };
        if (
          typeof failurePayload.verificationExitCode !== "number" ||
          failurePayload.verificationExitCode === 0
        ) {
          throw new Error(
            `expected non-zero verificationExitCode after a failing verify, got ${failurePayload.verificationExitCode}`,
          );
        }

        // Create the sentinel and retry: the same task must now flip to done.
        writeFileSync(sentinel, "ready\n");

        const secondAttempt = await ctx.agent.run(
          `depot task verify ${added.item.id} --user-confirmed 'sentinel cree, on peut continuer'`,
          { cwd: repo },
        );
        ctx.expect.exitCode(secondAttempt, 0);

        const rowAfterOk = ctx.expect.dbRow<TaskRow>("tasks", { id: added.item.id });
        if (rowAfterOk.status !== "done") {
          throw new Error(
            `expected task='done' after successful verify, got '${rowAfterOk.status}'`,
          );
        }
      }, "human-tasks C — verification fails then succeeds across two attempts");
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
    }
  });

  it("D — phase-advance refuses while the human task is pending; passes once verified", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("human-tasks-d");
      await ctx.agent.run("depot init human-tasks-d", { cwd: repo });

      // Seed a multi-phase PRD via `prd load` so `current_phase` is properly
      // initialised. Add the human task before `prd activate`: `task add` is
      // refused once the PRD leaves `draft`, so we attach it now and start the
      // lifecycle afterwards.
      const loadJson = JSON.stringify({
        title: "Human gate rollout",
        tasks: [
          {
            title: "P1 — coder slice",
            description: "Implement slice",
            doneCriteria: "Slice green",
            effort: "s",
            phase: 1,
          },
          {
            title: "P2 — follow-up",
            description: "Wire follow-up",
            doneCriteria: "Follow-up done",
            effort: "s",
            phase: 2,
          },
        ],
      });
      const loaded = await ctx.agent.runJson<PrdLoadPayload>("depot --json prd load", {
        cwd: repo,
        input: loadJson,
      });
      const prdId = loaded.prd.id;

      const humanTask = await ctx.agent.runJson<TaskPayload>(
        `depot --json task add --prd-id ${prdId} --title 'Vault rotation' --desc 'Rotate the secret' --criteria 'New secret live' --effort s --kind human --phase 1`,
        { cwd: repo },
      );

      await ctx.agent.run(`depot prd ready ${prdId}`, { cwd: repo });
      await ctx.agent.run(`depot prd activate ${prdId}`, { cwd: repo });

      const phase1Slice = loaded.tasks.find((t) => t.phaseNumber === 1)!;
      await ctx.agent.run(`depot task start ${phase1Slice.id}`, { cwd: repo });
      await ctx.agent.run(`depot task done ${phase1Slice.id}`, { cwd: repo });

      await ctx.agent.run(`depot prd request-review ${prdId}`, { cwd: repo });

      const reviewJson = await ctx.agent.runJson<{ item: { id: string } }>(
        `depot --json review start ${prdId} --type human`,
        { cwd: repo },
      );
      await ctx.agent.run(`depot review update ${reviewJson.item.id} --feedback 'looks fine'`, {
        cwd: repo,
      });
      await ctx.agent.run(`depot review done ${reviewJson.item.id}`, { cwd: repo });

      const blocked = await ctx.agent.run(`depot prd phase-advance ${prdId}`, {
        cwd: repo,
        expectExit: "any",
      });
      ctx.expect.exitCode(blocked, 1);
      ctx.expect.contains(blocked.stderr, "Vault rotation");

      const stillPending = ctx.expect.dbRow<TaskRow>("tasks", { id: humanTask.item.id });
      if (stillPending.status !== "pending") {
        throw new Error(
          `expected human task to stay 'pending' while phase-advance is blocked, got '${stillPending.status}'`,
        );
      }

      await ctx.agent.run(
        `depot task verify ${humanTask.item.id} --user-confirmed 'rotation terminee, peux avancer'`,
        { cwd: repo },
      );

      const advanced = await ctx.agent.runJson<{
        item: { status: string; currentPhase: number | null };
        advanced: boolean;
      }>(`depot --json prd phase-advance ${prdId}`, { cwd: repo });
      if (!advanced.advanced) {
        throw new Error(
          "expected phase-advance to flip to phase 2 once the human task is verified",
        );
      }
      if (advanced.item.currentPhase !== 2) {
        throw new Error(
          `expected currentPhase=2 after verified advance, got ${advanced.item.currentPhase}`,
        );
      }
    }, "human-tasks D — phase-advance gated by pending human task");
  });
});
