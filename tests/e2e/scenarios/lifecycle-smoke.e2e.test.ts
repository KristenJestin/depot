import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0015 / T2 — Lifecycle smoke + `--user-confirmed` anti-regression.
 * PRD 0022 / T1 — case B adapted: empty/whitespace rejected, short "go"
 *                 accepted (the length-min check was dropped).
 *
 * Three sub-scenarios, each with its own fresh tmp DB (separate `e2eScenario`
 * call):
 *
 *  A. Happy path : init → create → ready → activate → request-review → done,
 *     with `--user-confirmed` at every transition. The default runtime env
 *     ships `DEPOT_BYPASS_USER_CONFIRMATION=1`, so we override it to `""`
 *     on each lifecycle call to actually exercise the flag check.
 *
 *  B. Flag policy : a `prd ready` call is rejected when the flag is missing,
 *     rejected when the value is empty / whitespace-only, and accepted when
 *     a non-empty quote is provided — including a short one like "go".
 *
 *  C. Bypass env : with `DEPOT_BYPASS_USER_CONFIRMATION=1` (the runtime
 *     default), the same transition succeeds and the resulting `activity_log`
 *     payload records `userConfirmation: null`.
 */

type PrdRow = {
  id: string;
  status: string;
  workspaceId: string | null;
};

type CreateEnvelope = { item: PrdRow };

const REQUIRE_FLAG = { DEPOT_BYPASS_USER_CONFIRMATION: "" } as const;

describe("e2e lifecycle smoke + --user-confirmed transitions (PRD 0015 / T2)", () => {
  it("A. happy path: draft → ready → in_progress → review → done", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("my-app");

      await ctx.agent.run("depot init my-app", { cwd: repo });

      const created = await ctx.agent.runJson<CreateEnvelope>(
        "depot --json prd create --title 'Smoke PRD'",
        { cwd: repo },
      );
      const prdId = created.item.id;
      const draftRow = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (draftRow.status !== "draft") {
        throw new Error(`expected status=draft after create, got '${draftRow.status}'`);
      }

      await ctx.agent.run(`depot prd ready ${prdId} --user-confirmed 'go ahead'`, {
        cwd: repo,
        env: REQUIRE_FLAG,
      });
      const readyRow = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (readyRow.status !== "ready") {
        throw new Error(`expected status=ready after 'prd ready', got '${readyRow.status}'`);
      }

      await ctx.agent.run(`depot prd activate ${prdId} --user-confirmed 'go ahead'`, {
        cwd: repo,
        env: REQUIRE_FLAG,
      });
      const activatedRow = ctx.expect.dbRow<{ status: string; workspace_id: string | null }>(
        "prd_revisions",
        { id: prdId },
      );
      if (activatedRow.status !== "in_progress") {
        throw new Error(
          `expected status=in_progress after 'prd activate', got '${activatedRow.status}'`,
        );
      }
      if (!activatedRow.workspace_id) {
        throw new Error(`expected workspace_id to be set after 'prd activate', got null`);
      }

      await ctx.agent.run(`depot prd request-review ${prdId} --user-confirmed 'feedback please'`, {
        cwd: repo,
        env: REQUIRE_FLAG,
      });
      const reviewRow = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (reviewRow.status !== "review") {
        throw new Error(
          `expected status=review after 'prd request-review', got '${reviewRow.status}'`,
        );
      }

      await ctx.agent.run(`depot prd done ${prdId} --user-confirmed 'done the prd'`, {
        cwd: repo,
        env: REQUIRE_FLAG,
      });
      const doneRow = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (doneRow.status !== "done") {
        throw new Error(`expected status=done after 'prd done', got '${doneRow.status}'`);
      }

      const show = await ctx.agent.run(`depot prd show ${prdId}`, { cwd: repo });
      ctx.expect.contains(show.stdout, "done");
    }, "A. happy path lifecycle");
  });

  it("B. --user-confirmed flag enforcement (missing / empty / short valid)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("flag-policy");
      await ctx.agent.run("depot init flag-policy", { cwd: repo });
      const created = await ctx.agent.runJson<CreateEnvelope>(
        "depot --json prd create --title 'Flag policy PRD'",
        { cwd: repo },
      );
      const prdId = created.item.id;

      const missing = await ctx.agent.run(`depot prd ready ${prdId}`, {
        cwd: repo,
        env: REQUIRE_FLAG,
        expectExit: "any",
      });
      ctx.expect.exitCode(missing, 1);
      ctx.expect.contains(missing.stderr, "--user-confirmed");

      const stillDraft = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (stillDraft.status !== "draft") {
        throw new Error(
          `expected status=draft after rejected 'prd ready', got '${stillDraft.status}'`,
        );
      }

      const empty = await ctx.agent.run(`depot prd ready ${prdId} --user-confirmed ''`, {
        cwd: repo,
        env: REQUIRE_FLAG,
        expectExit: "any",
      });
      if (empty.exitCode === 0) {
        throw new Error(`expected non-zero exit for empty --user-confirmed, got 0`);
      }
      const emptyStderr = empty.stderr.toLowerCase();
      if (!emptyStderr.includes("empty") && !emptyStderr.includes("rejected")) {
        throw new Error(
          `expected stderr to mention "empty" or "rejected" for empty --user-confirmed, got: ${empty.stderr}`,
        );
      }

      const stillDraft2 = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (stillDraft2.status !== "draft") {
        throw new Error(
          `expected status=draft after empty 'prd ready', got '${stillDraft2.status}'`,
        );
      }

      await ctx.agent.run(`depot prd ready ${prdId} --user-confirmed 'go'`, {
        cwd: repo,
        env: REQUIRE_FLAG,
      });
      const readyRow = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (readyRow.status !== "ready") {
        throw new Error(
          `expected status=ready after short valid 'prd ready', got '${readyRow.status}'`,
        );
      }

      const logRow = ctx.expect.dbRow<{ payload: string }>("activity_log", {
        prd_revision_id: prdId,
        event_type: "prd_ready",
      });
      const payload = JSON.parse(logRow.payload) as Record<string, unknown>;
      if (payload["userConfirmation"] !== "go") {
        throw new Error(
          `expected activity_log.payload.userConfirmation === "go" after short quote, got: ${JSON.stringify(payload["userConfirmation"])}`,
        );
      }
    }, "B. flag policy");
  });

  it("C. DEPOT_BYPASS_USER_CONFIRMATION=1 records userConfirmation:null", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("bypass-env");
      await ctx.agent.run("depot init bypass-env", { cwd: repo });
      const created = await ctx.agent.runJson<CreateEnvelope>(
        "depot --json prd create --title 'Bypass env PRD'",
        { cwd: repo },
      );
      const prdId = created.item.id;

      await ctx.agent.run(`depot prd ready ${prdId}`, {
        cwd: repo,
        env: { DEPOT_BYPASS_USER_CONFIRMATION: "1" },
      });

      const readyRow = ctx.expect.dbRow<{ status: string }>("prd_revisions", { id: prdId });
      if (readyRow.status !== "ready") {
        throw new Error(
          `expected status=ready after bypassed 'prd ready', got '${readyRow.status}'`,
        );
      }

      const logRow = ctx.expect.dbRow<{ payload: string }>("activity_log", {
        prd_revision_id: prdId,
        event_type: "prd_ready",
      });
      const payload = JSON.parse(logRow.payload) as Record<string, unknown>;
      if (!("userConfirmation" in payload)) {
        throw new Error(
          `expected activity_log payload to contain userConfirmation key, got: ${logRow.payload}`,
        );
      }
      if (payload["userConfirmation"] !== null) {
        throw new Error(
          `expected activity_log.payload.userConfirmation === null under bypass, got: ${JSON.stringify(payload["userConfirmation"])}`,
        );
      }
    }, "C. bypass env");
  });
});
