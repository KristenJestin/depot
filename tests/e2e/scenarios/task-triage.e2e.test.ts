import { describe, it } from "vite-plus/test";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * PRD 0020 / T1 — `depot task triage` + `task list --triage` end-to-end.
 *
 * The domain-level unit suite lives in `tests/lib/task-triage.test.ts`; these
 * scenarios drive the built `dist/index.mjs` binary against a real SQLite
 * database so a regression in the CLI surface (subcommand wiring, argv
 * parsing, the `--triage` filter, the `ready-for-agent`-first sort, the
 * triage display in `task show`, activity_log writes) would surface here even
 * if the unit suite still passes.
 *
 * Sub-cases (each a fresh DB via `e2eScenario`):
 *
 *  A. Create a PRD with three tasks; `task triage <id> needs-info` flips one;
 *     `task list --triage needs-info --json` returns only that task; the
 *     remaining tasks default to `ready-for-agent`; `task show` prints the
 *     triage; activity_log carries the triage note.
 *  B. `task triage <id> bogus` exits non-zero and the error lists the valid
 *     triage states; the task keeps its default state.
 */

type PrdEnvelope = { item: { id: string; status: string } };
type TaskPayload = { item: { id: string; title: string; triageState: string } };
type ListEnvelope = { items: ReadonlyArray<{ id: string; title: string; triageState: string }> };
type ShowEnvelope = { item: { id: string; triageState: string } };

type TaskRow = { id: string; triage_state: string };
type ActivityRow = { id: string; event_type: string; payload: string };

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

async function addTask(
  ctx: ScenarioCtx,
  repo: string,
  prdId: string,
  title: string,
): Promise<TaskPayload["item"]> {
  const added = await ctx.agent.runJson<TaskPayload>(
    `depot --json task add --prd-id ${prdId} --title '${title}' --desc 'Do ${title}' --criteria 'Done ${title}' --effort s`,
    { cwd: repo },
  );
  return added.item;
}

describe("e2e: task triage (PRD 0020 / T1)", () => {
  it("A — triage sets state, --triage filters, show displays it, activity_log records it", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("task-triage-a");
      const { prdId } = await bootstrapPrd(ctx, repo, "task-triage-a");

      const t1 = await addTask(ctx, repo, prdId, "First");
      const t2 = await addTask(ctx, repo, prdId, "Second");
      const t3 = await addTask(ctx, repo, prdId, "Third");

      // New tasks default to ready-for-agent.
      ctx.expect.contains(t1.triageState, "ready-for-agent");

      const triaged = await ctx.agent.runJson<TaskPayload>(
        `depot --json task triage ${t2.id} needs-info --reason 'spec unclear'`,
        { cwd: repo },
      );
      if (triaged.item.triageState !== "needs-info") {
        throw new Error(
          `expected triageState='needs-info' after triage, got '${triaged.item.triageState}'`,
        );
      }

      const tasksRow = ctx.expect.dbRow<TaskRow>("tasks", { id: t2.id });
      if (tasksRow.triage_state !== "needs-info") {
        throw new Error(
          `expected tasks.triage_state='needs-info', got ${JSON.stringify(tasksRow.triage_state)}`,
        );
      }

      // `task list --triage needs-info` returns only the triaged task.
      const filtered = await ctx.agent.runJson<ListEnvelope>(
        `depot --json task list ${prdId} --triage needs-info`,
        { cwd: repo },
      );
      const filteredIds = filtered.items.map((t) => t.id);
      if (filteredIds.length !== 1 || filteredIds[0] !== t2.id) {
        throw new Error(
          `expected --triage needs-info to return [${t2.id}], got [${filteredIds.join(", ")}]`,
        );
      }
      if (filteredIds.includes(t1.id) || filteredIds.includes(t3.id)) {
        throw new Error(
          `expected --triage needs-info to exclude the ready-for-agent tasks; got [${filteredIds.join(", ")}]`,
        );
      }

      // The full list reports each task's triage state and sorts the
      // actionable ready-for-agent tasks ahead of the parked needs-info one.
      const all = await ctx.agent.runJson<ListEnvelope>(`depot --json task list ${prdId}`, {
        cwd: repo,
      });
      if (!all.items.every((t) => typeof t.triageState === "string" && t.triageState.length > 0)) {
        throw new Error(
          `expected every listed task to carry a triageState; got ${JSON.stringify(all.items)}`,
        );
      }
      const lastReadyIndex = all.items.reduce(
        (acc, t, i) => (t.triageState === "ready-for-agent" ? i : acc),
        -1,
      );
      const firstParkedIndex = all.items.findIndex((t) => t.triageState !== "ready-for-agent");
      if (firstParkedIndex !== -1 && lastReadyIndex > firstParkedIndex) {
        throw new Error(
          `expected ready-for-agent tasks sorted first; order: ${all.items.map((t) => t.triageState).join(", ")}`,
        );
      }

      // The text `task show` surfaces the triage state, and so does --json.
      const showText = await ctx.agent.run(`depot task show ${t2.id}`, { cwd: repo });
      ctx.expect.exitCode(showText, 0);
      ctx.expect.contains(showText.stdout, "needs-info");

      const showJson = await ctx.agent.runJson<ShowEnvelope>(`depot --json task show ${t2.id}`, {
        cwd: repo,
      });
      if (showJson.item.triageState !== "needs-info") {
        throw new Error(
          `expected task show --json triageState='needs-info', got '${showJson.item.triageState}'`,
        );
      }

      // activity_log carries the triage transition note.
      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        task_id: t2.id,
        event_type: "note",
      });
      const payload = JSON.parse(logRow.payload) as { message: string };
      ctx.expect.contains(payload.message, "ready-for-agent");
      ctx.expect.contains(payload.message, "needs-info");
      ctx.expect.contains(payload.message, "spec unclear");
    }, "task-triage A — set + filter + show + activity_log");
  });

  it("B — `task triage <id> bogus` exits non-zero and lists valid triage states", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("task-triage-b");
      const { prdId } = await bootstrapPrd(ctx, repo, "task-triage-b");

      const task = await addTask(ctx, repo, prdId, "Only");

      const result = await ctx.agent.run(`depot task triage ${task.id} bogus`, {
        cwd: repo,
        expectExit: "any",
      });
      if (result.exitCode === 0) {
        throw new Error(
          `expected non-zero exit for invalid triage state, got 0; stdout=${result.stdout}; stderr=${result.stderr}`,
        );
      }
      const combinedErr = `${result.stderr}\n${result.stdout}`;
      for (const expected of ["needs-info", "ready-for-agent", "wontfix"]) {
        if (!combinedErr.includes(expected)) {
          throw new Error(
            `expected error output to list valid triage state '${expected}'; stderr=${result.stderr}; stdout=${result.stdout}`,
          );
        }
      }

      // The task keeps its default triage state.
      const row = ctx.expect.dbRow<TaskRow>("tasks", { id: task.id });
      if (row.triage_state !== "ready-for-agent") {
        throw new Error(
          `expected tasks.triage_state to stay 'ready-for-agent' after rejected triage, got ${JSON.stringify(row.triage_state)}`,
        );
      }
    }, "task-triage B — invalid state rejected with non-zero exit");
  });
});
