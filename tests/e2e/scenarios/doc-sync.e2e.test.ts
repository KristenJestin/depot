import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T1 — Doc sync end-to-end.
 *
 * Three sub-cases, each a fresh DB:
 *  A. After a commit lands in `src/`, `depot doc sync <profile> --since … --no-dryRun`
 *     succeeds and writes a `doc_sync_runs` row with the resolved diff range
 *     (`since_ref` is populated from the explicit `--since`). PRD 0023 / T1
 *     removed the silent `HEAD~20` fallback, so range-less syncs now refuse;
 *     the row-writing concern this case targets is exercised with an explicit
 *     ref. The refusal path itself is covered by `doc-sync-range.e2e.test.ts`.
 *  B. A blocking `pre-doc-sync` directive that succeeds (`echo OK`) keeps the
 *     sync green. `depot doc pre-sync-check` returns exit 0 and the activity
 *     log records the `pre_doc_sync_check` event with `ok=true`.
 *  C. Swapping the directive for a failing one (`exit 1`) makes
 *     `depot doc pre-sync-check` exit non-zero, and the activity log records
 *     `ok=false` with the failing directive's id.
 *
 * `dryRun` defaults to true on `doc sync` so we pass `--no-dryRun` explicitly
 * to exercise the row-writing code path that PRD 0016 actually cares about.
 */

type DocProfilePayload = {
  item: { id: string; name: string; targetRoot: string; sources: string };
};

type SyncRunRow = {
  id: string;
  profile_id: string;
  since_ref: string | null;
};

type ActivityRow = {
  id: string;
  event_type: string;
  payload: string;
};

type DirectivePayload = {
  item: { id: string; title: string; scope: string; category: string };
};

describe("e2e doc sync end-to-end (PRD 0016 / T1)", () => {
  it("A — `doc sync --no-dryRun` writes a doc_sync_runs row with the diff range", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("doc-sync-a");
      await ctx.agent.run("depot init doc-sync-a", { cwd: repo });

      const profile = await ctx.agent.runJson<DocProfilePayload>(
        "depot --json doc profile create p1 --targetRoot docs",
        { cwd: repo },
      );
      await ctx.agent.run("depot doc profile set p1 --addSource 'src=./src' --language fr", {
        cwd: repo,
      });

      await ctx.git.commit(repo, { "src/feature.ts": "export const x = 1;\n" }, "add feature");

      const result = await ctx.agent.run("depot doc sync p1 --since HEAD~1 --no-dryRun", {
        cwd: repo,
      });
      ctx.expect.exitCode(result, 0);

      const run = ctx.expect.dbRow<SyncRunRow>("doc_sync_runs", { profile_id: profile.item.id });
      if (run.since_ref === null) {
        throw new Error(
          `expected doc_sync_runs.since_ref to be populated, got null. ` +
            `Row: ${JSON.stringify(run)}`,
        );
      }
    }, "doc-sync A — sync writes doc_sync_runs row");
  });

  it("B — passing pre-sync-check directive is executed before sync and records ok=true", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("doc-sync-b");
      await ctx.agent.run("depot init doc-sync-b", { cwd: repo });

      await ctx.agent.run("depot doc profile create p1 --targetRoot docs", { cwd: repo });
      await ctx.agent.run("depot doc profile set p1 --addSource 'src=./src' --language fr", {
        cwd: repo,
      });
      await ctx.git.commit(repo, { "src/feature.ts": "export const x = 1;\n" }, "add feature");

      await ctx.agent.run(
        "depot project directive add --category doc --scope pre-doc-sync --kind command " +
          "--title 'pre-doc-ok' --instruction 'echo OK'",
        { cwd: repo },
      );

      const check = await ctx.agent.run("depot doc pre-sync-check p1", { cwd: repo });
      ctx.expect.exitCode(check, 0);
      ctx.expect.contains(check.stdout, "pre-doc-ok");

      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        event_type: "pre_doc_sync_check",
      });
      const payload = JSON.parse(logRow.payload) as { ok: boolean; failingDirectiveId?: string };
      if (payload.ok !== true) {
        throw new Error(
          `expected pre_doc_sync_check payload.ok=true after passing directive, got ${JSON.stringify(payload)}`,
        );
      }

      // The doc sync itself remains usable after a passing pre-check.
      const sync = await ctx.agent.run("depot doc sync p1 --since HEAD~1 --no-dryRun", {
        cwd: repo,
      });
      ctx.expect.exitCode(sync, 0);
    }, "doc-sync B — passing pre-sync-check directive is honoured");
  });

  it("C — failing pre-sync-check directive blocks with non-zero exit and ok=false in activity_log", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("doc-sync-c");
      await ctx.agent.run("depot init doc-sync-c", { cwd: repo });

      await ctx.agent.run("depot doc profile create p1 --targetRoot docs", { cwd: repo });
      await ctx.agent.run("depot doc profile set p1 --addSource 'src=./src' --language fr", {
        cwd: repo,
      });
      await ctx.git.commit(repo, { "src/feature.ts": "export const x = 1;\n" }, "add feature");

      const failing = await ctx.agent.runJson<DirectivePayload>(
        "depot --json project directive add --category doc --scope pre-doc-sync --kind command " +
          "--title 'pre-doc-fail' --instruction 'exit 1'",
        { cwd: repo },
      );

      const check = await ctx.agent.run("depot doc pre-sync-check p1", {
        cwd: repo,
        expectExit: "any",
      });
      if (check.exitCode === 0) {
        throw new Error(`expected non-zero exit when directive exits 1, got 0`);
      }

      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        event_type: "pre_doc_sync_check",
      });
      const payload = JSON.parse(logRow.payload) as { ok: boolean; failingDirectiveId?: string };
      if (payload.ok !== false) {
        throw new Error(
          `expected pre_doc_sync_check payload.ok=false after failing directive, got ${JSON.stringify(payload)}`,
        );
      }
      if (payload.failingDirectiveId !== failing.item.id) {
        throw new Error(
          `expected failingDirectiveId=${failing.item.id}, got ${payload.failingDirectiveId}`,
        );
      }
    }, "doc-sync C — failing pre-sync-check blocks");
  });
});
