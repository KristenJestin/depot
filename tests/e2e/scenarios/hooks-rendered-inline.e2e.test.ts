import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * PRD 0015 / T5 — Directives and hooks are rendered inline by `depot context`.
 *
 * These scenarios pin the user-visible contract of PRD 0013's inline renderer:
 *  - ground rules (scope=always) appear in the head of `depot context dev`;
 *  - hooks (scope=post-auditor-pass) appear at the right position in the dev
 *    flow when a PRD is being worked on;
 *  - an explicit `_No project hooks at this stage._` placeholder is emitted
 *    when no directive matches a marker's (category, scope);
 *  - a directive with `enabled = false` is filtered out of the rendering;
 *  - `directive add` rejects an invalid `(category, scope)` combination at
 *    the CLI surface with a guidance-rich stderr message.
 */

type CreatedPrd = { item: { prdId: string } };

describe("e2e: hooks and directives rendered inline by depot context", () => {
  it("A — ground rule (scope=always, category=dev) is rendered in the head of `depot context dev`", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("app");
      await ctx.agent.run("depot init app", { cwd: repo });

      await ctx.agent.run(
        "depot project directive add --category dev --scope always --kind rule " +
          "--title 'House rule' --instruction 'Always run lint before commit'",
        { cwd: repo },
      );

      const result = await ctx.agent.run("depot context dev", { cwd: repo });
      ctx.expect.exitCode(result, 0);
      ctx.expect.contains(result.stdout, "Project ground rules");
      ctx.expect.contains(result.stdout, "House rule");
      ctx.expect.contains(result.stdout, "Always run lint before commit");
    }, "hooks-inline A — ground rule rendered in dev context head");
  });

  it("B — post-auditor-pass hook is rendered at the right position in `depot context dev <prd>`", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("app");
      await ctx.agent.run("depot init app", { cwd: repo });

      await ctx.agent.run(
        "depot project directive add --category dev --scope post-auditor-pass --kind rule " +
          "--title 'Run tester sub-agent' " +
          "--instruction 'Spawn a tester sub-agent before handoff'",
        { cwd: repo },
      );

      const prd = await ctx.agent.runJson<CreatedPrd>("depot prd create --title 'X' --json", {
        cwd: repo,
      });

      const result = await ctx.agent.run(`depot context dev ${prd.item.prdId}`, { cwd: repo });
      ctx.expect.exitCode(result, 0);
      ctx.expect.contains(result.stdout, "post-auditor-pass");
      ctx.expect.contains(result.stdout, "Run tester sub-agent");
      ctx.expect.contains(result.stdout, "Spawn a tester sub-agent before handoff");
    }, "hooks-inline B — post-auditor-pass hook rendered in dev flow");
  });

  it("C — when no hook matches a scope, the placeholder is visible", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("app");
      await ctx.agent.run("depot init app", { cwd: repo });

      const prd = await ctx.agent.runJson<CreatedPrd>("depot prd create --title 'X' --json", {
        cwd: repo,
      });

      const result = await ctx.agent.run(`depot context dev ${prd.item.prdId}`, { cwd: repo });
      ctx.expect.exitCode(result, 0);
      ctx.expect.contains(result.stdout, "No project hooks at this stage");
    }, "hooks-inline C — empty-scope placeholder visible");
  });

  it("D — a disabled directive is NOT rendered", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("app");
      await ctx.agent.run("depot init app", { cwd: repo });

      await ctx.agent.run(
        "depot project directive add --category dev --scope always --kind rule " +
          "--title 'Disabled rule' --instruction 'Should not appear'",
        { cwd: repo },
      );

      const listed = await ctx.agent.runJson<{
        items: ReadonlyArray<{ id: string; title: string }>;
      }>("depot project directive list --json", { cwd: repo });
      const target = listed.items.find((d) => d.title === "Disabled rule");
      if (!target) {
        throw new Error(
          "expected to find the just-created 'Disabled rule' directive in the list output, " +
            `got: ${JSON.stringify(listed.items)}`,
        );
      }

      await ctx.agent.run(`depot project directive disable ${target.id}`, { cwd: repo });

      const result = await ctx.agent.run("depot context dev", { cwd: repo });
      ctx.expect.exitCode(result, 0);
      ctx.expect.notContains(result.stdout, "Disabled rule");
      ctx.expect.notContains(result.stdout, "Should not appear");
    }, "hooks-inline D — disabled directive not rendered");
  });

  it("E — `directive add` rejects an invalid (category, scope) combination with a clear stderr message", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("app");
      await ctx.agent.run("depot init app", { cwd: repo });

      const result = await ctx.agent.run(
        "depot project directive add --category doc --scope post-auditor-pass --kind rule " +
          "--title 'X' --instruction 'Y'",
        { cwd: repo, expectExit: "any" },
      );
      ctx.expect.exitCode(result, 1);
      // The validator emits an `Invalid (category, scope) combination …` message
      // followed by `Valid scopes for category 'doc': …`. Assert on the
      // category-qualified phrase so the test stays robust to surrounding
      // wording tweaks but breaks loudly if the rejection silently widens.
      ctx.expect.contains(result.stderr, "Valid scopes for category 'doc'");
      ctx.expect.contains(result.stderr, "(doc, post-auditor-pass)");
    }, "hooks-inline E — invalid (category, scope) rejected with clear stderr");
  });
});
