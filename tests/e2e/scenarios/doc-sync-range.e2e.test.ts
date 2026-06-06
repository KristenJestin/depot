import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0023 — Doc-sync range resolution.
 *
 * T1 (refuse-don't-guess) covers:
 *  B. No `--since` and no `docSyncTicketPattern` configured → `depot doc sync`
 *     refuses with a non-zero exit and a guide message. The output must not
 *     leak the old `HEAD~20` fallback nor a raw `(FiberFailure)` blob (the
 *     refusal is a clean `ValidationError`, surfaced per PRD 0017 / T1).
 *  C. An explicit `--since` wins: the same profile that refuses in B resolves
 *     cleanly when a range is supplied, and `doc_sync_runs.since_ref` records
 *     the explicit ref (never `HEAD~20`).
 *
 * T2 (ticket-grep strategy) adds:
 *  A. A real repo whose base branch carries a squash commit referencing
 *     `TICKET-1234`. With `docSyncTicketPattern=TICKET-\d+` configured and a PRD whose
 *     body has `Refs TICKET-1234`, `depot doc sync --prd <id>` resolves the range
 *     from the squash (`since=<squash>^`, not `HEAD~20`) and records it.
 *  D. Multi-repo: two registered repos each carry their own squash for the
 *     ticket and resolve independently; a third repo with no matching commit is
 *     excluded cleanly (an info line, not a hard error).
 */

type DocProfilePayload = {
  item: { id: string; name: string; targetRoot: string; sources: string };
};

type PrdPayload = {
  item: { id: string };
};

type SyncRunRow = {
  id: string;
  profile_id: string;
  since_ref: string | null;
  until_ref: string | null;
};

describe("e2e doc-sync range resolution (PRD 0023 / T1)", () => {
  it("B — no --since and no pattern → refuses with a guide message (no HEAD~20, no FiberFailure)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("doc-sync-range-b");
      await ctx.agent.run("depot init doc-sync-range-b", { cwd: repo });

      await ctx.agent.run("depot doc profile create p1 --targetRoot docs", { cwd: repo });
      await ctx.agent.run("depot doc profile set p1 --addSource 'src=./src' --language fr", {
        cwd: repo,
      });
      await ctx.git.commit(repo, { "src/feature.ts": "export const x = 1;\n" }, "add feature");

      const result = await ctx.agent.run("depot doc sync p1 --no-dryRun", {
        cwd: repo,
        expectExit: "any",
      });

      if (result.exitCode === 0) {
        throw new Error(
          `expected non-zero exit when no range is resolvable, got 0\n` +
            `  stdout: ${result.stdout}\n  stderr: ${result.stderr}`,
        );
      }

      const combined = `${result.stdout}\n${result.stderr}`;
      ctx.expect.contains(combined, "cannot determine the feature's commit range");
      ctx.expect.contains(combined, "--since");
      ctx.expect.notContains(combined, "HEAD~20");
      ctx.expect.notContains(combined, "FiberFailure");
    }, "doc-sync-range B — refuses without a resolvable range");
  });

  it("C — explicit --since wins and records the ref (never HEAD~20)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("doc-sync-range-c");
      await ctx.agent.run("depot init doc-sync-range-c", { cwd: repo });

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
      ctx.expect.contains(result.stdout, "[expr]");
      ctx.expect.notContains(result.stdout, "HEAD~20");

      const run = ctx.expect.dbRow<SyncRunRow>("doc_sync_runs", {
        profile_id: profile.item.id,
      });
      if (run.since_ref !== "HEAD~1") {
        throw new Error(
          `expected doc_sync_runs.since_ref='HEAD~1' from explicit --since, got ${JSON.stringify(run.since_ref)}`,
        );
      }
    }, "doc-sync-range C — explicit --since wins");
  });
});

describe("e2e doc-sync ticket-grep (PRD 0023 / T2)", () => {
  it("A — resolves the squash range from the PRD ticket (since=<squash>^, not HEAD~20)", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("doc-sync-range-a");
      await ctx.agent.run("depot init doc-sync-range-a", { cwd: repo });

      const profile = await ctx.agent.runJson<DocProfilePayload>(
        "depot --json doc profile create p1 --targetRoot docs",
        { cwd: repo },
      );
      await ctx.agent.run("depot doc profile set p1 --addSource 'src=./src' --language fr", {
        cwd: repo,
      });

      // The base branch (main) carries several commits; only one — the squash —
      // references the ticket. ticket-grep must single it out, not retreat to a
      // commit-count window.
      await ctx.git.commit(repo, { "src/a.ts": "export const a = 1;\n" }, "chore: noise one");
      await ctx.git.commit(repo, { "src/b.ts": "export const b = 2;\n" }, "chore: noise two");
      await ctx.git.commit(
        repo,
        { "src/feature.ts": "export const x = 1;\n" },
        "feat: ship the feature (TICKET-1234)",
      );
      await ctx.git.commit(repo, { "src/c.ts": "export const c = 3;\n" }, "chore: noise three");

      const squash = (
        await ctx.agent.run("git log --grep=TICKET-1234 --format=%H -n 1", { cwd: repo })
      ).stdout.trim();

      await ctx.agent.run("depot project config set docSyncTicketPattern 'TICKET-\\d+'", {
        cwd: repo,
      });

      const prd = await ctx.agent.runJson<PrdPayload>(
        "depot --json prd create --title 'Doc sync feature' --context 'Background. Refs TICKET-1234'",
        { cwd: repo },
      );

      const result = await ctx.agent.run(`depot doc sync p1 --prd ${prd.item.id} --no-dryRun`, {
        cwd: repo,
      });
      ctx.expect.exitCode(result, 0);
      ctx.expect.contains(result.stdout, "[ticket-grep]");
      ctx.expect.contains(result.stdout, `since=${squash}^`);
      ctx.expect.notContains(result.stdout, "HEAD~20");

      const run = ctx.expect.dbRow<SyncRunRow>("doc_sync_runs", {
        profile_id: profile.item.id,
      });
      if (run.since_ref !== `${squash}^`) {
        throw new Error(
          `expected doc_sync_runs.since_ref='${squash}^' from ticket-grep, got ${JSON.stringify(run.since_ref)}`,
        );
      }
      if (run.until_ref !== squash) {
        throw new Error(
          `expected doc_sync_runs.until_ref='${squash}', got ${JSON.stringify(run.until_ref)}`,
        );
      }
    }, "doc-sync-range A — ticket-grep resolves the squash range");
  });

  it("D — multi-repo: each repo resolves its own squash; a repo with no match is excluded", async () => {
    await e2eScenario(async (ctx) => {
      // The workspace root holds the depot DB; the three source repos live in
      // sibling directories and are registered as project_repos.
      const workspace = await ctx.dir.create("doc-sync-range-d");
      const front = await ctx.git.initRepoIn(workspace, "front");
      const api = await ctx.git.initRepoIn(workspace, "api");
      const common = await ctx.git.initRepoIn(workspace, "common");

      await ctx.agent.run("depot init doc-sync-range-d", { cwd: workspace });

      await ctx.agent.run("depot project repo add --name front --path front --baseBranch main", {
        cwd: workspace,
      });
      await ctx.agent.run("depot project repo add --name api --path api --baseBranch main", {
        cwd: workspace,
      });
      await ctx.agent.run("depot project repo add --name common --path common --baseBranch main", {
        cwd: workspace,
      });

      const profile = await ctx.agent.runJson<DocProfilePayload>(
        "depot --json doc profile create p1 --targetRoot docs",
        { cwd: workspace },
      );
      await ctx.agent.run("depot doc profile set p1 --addSource 'src=./src' --language fr", {
        cwd: workspace,
      });

      // front + api each carry their own distinct squash for the ticket.
      // common carries only unrelated commits → it must be excluded, not error.
      await ctx.git.commit(front, { "src/f.ts": "export const f = 1;\n" }, "chore: front noise");
      await ctx.git.commit(
        front,
        { "src/feature.ts": "export const x = 1;\n" },
        "feat: front part (TICKET-1234)",
      );
      await ctx.git.commit(api, { "src/a.ts": "export const a = 1;\n" }, "chore: api noise");
      await ctx.git.commit(
        api,
        { "src/feature.ts": "export const y = 2;\n" },
        "feat: api part (TICKET-1234)",
      );
      await ctx.git.commit(
        common,
        { "src/c.ts": "export const c = 3;\n" },
        "chore: common unrelated",
      );

      const frontSquash = (
        await ctx.agent.run("git log --grep=TICKET-1234 --format=%H -n 1", { cwd: front })
      ).stdout.trim();
      const apiSquash = (
        await ctx.agent.run("git log --grep=TICKET-1234 --format=%H -n 1", { cwd: api })
      ).stdout.trim();

      await ctx.agent.run("depot project config set docSyncTicketPattern 'TICKET-\\d+'", {
        cwd: workspace,
      });

      const prd = await ctx.agent.runJson<PrdPayload>(
        "depot --json prd create --title 'Multi-repo feature' --context 'Refs TICKET-1234'",
        { cwd: workspace },
      );

      const result = await ctx.agent.run(`depot doc sync p1 --prd ${prd.item.id} --no-dryRun`, {
        cwd: workspace,
      });
      ctx.expect.exitCode(result, 0);
      ctx.expect.contains(result.stdout, "Repo: front");
      ctx.expect.contains(result.stdout, "Repo: api");
      ctx.expect.contains(result.stdout, `since=${frontSquash}^`);
      ctx.expect.contains(result.stdout, `since=${apiSquash}^`);
      ctx.expect.contains(result.stdout, "[ticket-grep]");
      // common is excluded with an info line, not a failure.
      ctx.expect.contains(result.stdout, "common");
      ctx.expect.contains(result.stdout, "excluded");
      ctx.expect.notContains(result.stdout, "HEAD~20");
      ctx.expect.notContains(result.stdout, "FiberFailure");

      // Two sync runs recorded (front + api); common produced none.
      const front_run = ctx.expect.dbRow<SyncRunRow>("doc_sync_runs", {
        profile_id: profile.item.id,
        since_ref: `${frontSquash}^`,
      });
      const api_run = ctx.expect.dbRow<SyncRunRow>("doc_sync_runs", {
        profile_id: profile.item.id,
        since_ref: `${apiSquash}^`,
      });
      if (front_run.until_ref !== frontSquash || api_run.until_ref !== apiSquash) {
        throw new Error(
          `expected per-repo until_ref to match each squash, got front=${JSON.stringify(front_run.until_ref)} api=${JSON.stringify(api_run.until_ref)}`,
        );
      }
    }, "doc-sync-range D — multi-repo ticket-grep with one excluded repo");
  });
});
