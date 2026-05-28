import { describe, it } from "vite-plus/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { e2eScenario } from "../runtime";

/**
 * PRD 0016 / T2 — `depot install --claude-code` materialization.
 *
 * `depot install --claude-code` writes a fixed set of slash-command files
 * under `<HOME>/.claude/commands/depot-{prd,dev,doc,ship}.md`. The user
 * never specifies the target directory directly — it is derived from
 * `HOME`. We override `HOME` to a tmp dir so the test never pollutes the
 * developer's real `~/.claude`.
 *
 * Two sub-cases bake in the contract published to claude-code users:
 *  a) the four command files are written to the expected absolute paths;
 *  b) each file ships with the `disable-model-invocation: true`
 *     frontmatter and embeds an inline invocation of `depot context <mode>`.
 *     Both pieces are user-visible: dropping the frontmatter would re-enable
 *     auto-invocation, dropping the inline command would turn the slash
 *     command into a no-op.
 */

describe("e2e: depot install --claude-code materialization (PRD 0016 / T2)", () => {
  it("a) writes depot-{prd,dev,doc,ship}.md under <tmpHome>/.claude/commands", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("install-app");
      await ctx.agent.run("depot init install-app", { cwd: repo });

      const tmpHome = await ctx.dir.create("fakehome");
      await ctx.agent.run("depot install --claude-code", {
        cwd: repo,
        env: { HOME: tmpHome },
      });

      const commandsDir = path.join(tmpHome, ".claude", "commands");
      for (const mode of ["prd", "dev", "doc", "ship"]) {
        const filePath = path.join(commandsDir, `depot-${mode}.md`);
        const body = await readFile(filePath, "utf-8");
        // Sanity: the file is non-empty and at least mentions the mode label
        // somewhere, which guards against truncated writes.
        if (body.length === 0) {
          throw new Error(`expected ${filePath} to be non-empty, got 0 bytes`);
        }
        ctx.expect.contains(body, mode);
      }
    }, "install materialization (a) file paths");
  });

  it("b) depot-dev.md ships disable-model-invocation frontmatter + embeds `depot context dev`", async () => {
    await e2eScenario(async (ctx) => {
      const repo = await ctx.git.initRepo("install-content");
      await ctx.agent.run("depot init install-content", { cwd: repo });

      const tmpHome = await ctx.dir.create("fakehome");
      await ctx.agent.run("depot install --claude-code", {
        cwd: repo,
        env: { HOME: tmpHome },
      });

      const devFile = path.join(tmpHome, ".claude", "commands", "depot-dev.md");
      const body = await readFile(devFile, "utf-8");

      ctx.expect.contains(body, "disable-model-invocation: true");
      ctx.expect.contains(body, "depot context dev");
    }, "install materialization (b) content");
  });
});
