import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * Friction relayed from dogfooding: `prd out-of-scope add` silently dropped a
 * positional PRD id and recorded the item as project-wide. The PRD id is now a
 * positional arg (consistent with `prd show <id>`, `out-of-scope remove <id>`),
 * so a positional revId actually scopes the item. `rm` is a `remove` alias.
 */

type CreateEnvelope = { item: { id: string } };

describe("e2e out-of-scope positional scoping", () => {
  it("scopes to the PRD when a positional revId is passed, project-wide otherwise", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("oos-app");
      await ctx.agent.run("depot init oos-app", { cwd: repo });

      const created = await ctx.agent.runJson<CreateEnvelope>(
        "depot --json prd create --title 'OOS PRD'",
        { cwd: repo },
      );
      const revId = created.item.id;

      await ctx.agent.run(`depot prd out-of-scope add ${revId} -t 'Scoped item' -r 'because'`, {
        cwd: repo,
      });
      const scoped = ctx.expect.dbRow<{ prd_revision_id: string | null }>("out_of_scope_items", {
        title: "Scoped item",
      });
      if (scoped.prd_revision_id !== revId) {
        throw new Error(
          `expected positional revId to scope the item to '${revId}', got '${scoped.prd_revision_id}'`,
        );
      }

      await ctx.agent.run(`depot prd out-of-scope add -t 'Global item' -r 'because'`, {
        cwd: repo,
      });
      const global = ctx.expect.dbRow<{ prd_revision_id: string | null }>("out_of_scope_items", {
        title: "Global item",
      });
      if (global.prd_revision_id !== null) {
        throw new Error(
          `expected no positional to record a project-wide item, got prd_revision_id='${global.prd_revision_id}'`,
        );
      }

      // `rm` mirrors the destructive-subcommand convention and aliases `remove`.
      const listed = await ctx.agent.runJson<{ items: Array<{ id: string }> }>(
        `depot --json prd out-of-scope list ${revId}`,
        { cwd: repo },
      );
      await ctx.agent.run(`depot prd out-of-scope rm ${listed.items[0]!.id}`, { cwd: repo });
    });
  });
});
