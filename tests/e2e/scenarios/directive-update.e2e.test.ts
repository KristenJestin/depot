import { describe, it } from "vite-plus/test";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * PRD 0017 / T5 — `depot project directive update` end-to-end.
 *
 * T5's unit-level coverage lives in `tests/cli/projects-directive-update.test.ts`.
 * These scenarios exercise the same surface through the real `dist/index.mjs`
 * binary against a real SQLite DB, so a regression in argv parsing, the
 * activity-log write path, or the (category, scope) validator would surface
 * here even if the unit tests still pass.
 *
 * Sub-cases (each a fresh DB):
 *  A. Re-category from dev/pre-review → auditor: `directive update --category
 *     auditor`, then `directive list --category auditor` shows the directive.
 *  B. Update --title only: dbRow on project_directives confirms the flip, and
 *     the activity_log row for `directive_updated` carries
 *     `payload.changes.title = {from, to}`.
 *  C. Invalid combination (--category doc --scope post-auditor-pass) → exit 1,
 *     stderr lists the valid scopes for `doc` (`always`, `pre-doc-sync`).
 *  D. No editable flag → exit 1 with "Nothing to update".
 */

type DirectivePayload = {
  item: { id: string; title: string; scope: string; category: string };
};

type DirectiveListPayload = {
  items: ReadonlyArray<{ id: string; title: string; scope: string; category: string }>;
};

type DirectiveRow = {
  id: string;
  title: string;
  scope: string;
  category: string | null;
};

type ActivityRow = {
  id: string;
  event_type: string;
  payload: string;
};

async function seedDirective(ctx: ScenarioCtx, repo: string): Promise<DirectivePayload["item"]> {
  const seeded = await ctx.agent.runJson<DirectivePayload>(
    "depot --json project directive add --category dev --scope pre-review --kind rule " +
      "--title 'Initial title' --instruction 'noop'",
    { cwd: repo },
  );
  return seeded.item;
}

describe("e2e: project directive update (PRD 0017 / T5)", () => {
  it("A — re-category dev → auditor is reflected by `directive list --category auditor`", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("directive-update-a");
      await ctx.agent.run("depot init directive-update-a", { cwd: repo });
      const seeded = await seedDirective(ctx, repo);

      const updateResult = await ctx.agent.run(
        `depot project directive update ${seeded.id} --category auditor`,
        { cwd: repo },
      );
      ctx.expect.exitCode(updateResult, 0);
      ctx.expect.contains(updateResult.stdout, "category");

      const listed = await ctx.agent.runJson<DirectiveListPayload>(
        "depot --json project directive list --category auditor",
        { cwd: repo },
      );
      const found = listed.items.find((d) => d.id === seeded.id);
      if (!found) {
        throw new Error(
          `expected to find directive ${seeded.id} when filtering by category=auditor, ` +
            `got: ${JSON.stringify(listed.items)}`,
        );
      }
      if (found.category !== "auditor") {
        throw new Error(`expected directive.category=auditor after update, got ${found.category}`);
      }
      // Scope was not patched so it must still be the seeded value.
      if (found.scope !== "pre-review") {
        throw new Error(`expected directive.scope=pre-review (unchanged), got ${found.scope}`);
      }
    }, "directive-update A — re-category dev → auditor visible via list --category");
  });

  it("B — `update --title` flips the row and logs directive_updated with changes.title {from, to}", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("directive-update-b");
      await ctx.agent.run("depot init directive-update-b", { cwd: repo });
      const seeded = await seedDirective(ctx, repo);

      const updateResult = await ctx.agent.run(
        `depot project directive update ${seeded.id} --title 'Renamed title'`,
        { cwd: repo },
      );
      ctx.expect.exitCode(updateResult, 0);

      const row = ctx.expect.dbRow<DirectiveRow>("project_directives", { id: seeded.id });
      if (row.title !== "Renamed title") {
        throw new Error(`expected project_directives.title='Renamed title', got '${row.title}'`);
      }
      // Title-only patch must not silently drift other fields.
      if (row.category !== "dev" || row.scope !== "pre-review") {
        throw new Error(
          `expected (category, scope) untouched at (dev, pre-review), got (${row.category}, ${row.scope})`,
        );
      }

      const logRow = ctx.expect.dbRow<ActivityRow>("activity_log", {
        event_type: "directive_updated",
      });
      const payload = JSON.parse(logRow.payload) as {
        directiveId: string;
        changes: Record<string, { from: unknown; to: unknown }>;
      };
      if (payload.directiveId !== seeded.id) {
        throw new Error(
          `expected directive_updated.payload.directiveId=${seeded.id}, got ${payload.directiveId}`,
        );
      }
      const titleChange = payload.changes.title;
      if (!titleChange) {
        throw new Error(
          `expected payload.changes.title to be present, got changes=${JSON.stringify(payload.changes)}`,
        );
      }
      if (titleChange.from !== "Initial title" || titleChange.to !== "Renamed title") {
        throw new Error(
          `expected changes.title={from:'Initial title',to:'Renamed title'}, got ${JSON.stringify(titleChange)}`,
        );
      }
      // Unchanged fields must NOT appear in the diff (PRD 0017 / T5 contract).
      if (payload.changes.category !== undefined) {
        throw new Error(
          `expected category to be absent from changes (untouched), got ${JSON.stringify(payload.changes.category)}`,
        );
      }
      if (payload.changes.scope !== undefined) {
        throw new Error(
          `expected scope to be absent from changes (untouched), got ${JSON.stringify(payload.changes.scope)}`,
        );
      }
    }, "directive-update B — title-only update + directive_updated diff payload");
  });

  it("C — invalid (category, scope) combination exits 1 and stderr lists valid scopes for the category", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("directive-update-c");
      await ctx.agent.run("depot init directive-update-c", { cwd: repo });
      const seeded = await seedDirective(ctx, repo);

      const result = await ctx.agent.run(
        `depot project directive update ${seeded.id} --category doc --scope post-auditor-pass`,
        { cwd: repo, expectExit: "any" },
      );
      ctx.expect.exitCode(result, 1);
      ctx.expect.contains(result.stderr, "(doc, post-auditor-pass)");
      ctx.expect.contains(result.stderr, "Valid scopes for category 'doc'");
      // The two valid scopes for `doc` per the (category, scope) matrix.
      ctx.expect.contains(result.stderr, "always");
      ctx.expect.contains(result.stderr, "pre-doc-sync");

      // The rejected update must not have mutated the row.
      const row = ctx.expect.dbRow<DirectiveRow>("project_directives", { id: seeded.id });
      if (row.category !== "dev" || row.scope !== "pre-review") {
        throw new Error(
          `expected directive unchanged after rejected update, got (${row.category}, ${row.scope})`,
        );
      }
    }, "directive-update C — invalid (doc, post-auditor-pass) rejected with guidance");
  });

  it("D — no editable flag exits 1 with 'Nothing to update' and writes no activity row", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("directive-update-d");
      await ctx.agent.run("depot init directive-update-d", { cwd: repo });
      const seeded = await seedDirective(ctx, repo);

      const result = await ctx.agent.run(`depot project directive update ${seeded.id}`, {
        cwd: repo,
        expectExit: "any",
      });
      ctx.expect.exitCode(result, 1);
      ctx.expect.contains(result.stderr, "Nothing to update");
    }, "directive-update D — no flag exits 1 with 'Nothing to update'");
  });
});
