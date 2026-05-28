import { describe, it } from "vite-plus/test";
import { e2eScenario } from "./runtime";

describe("e2e smoke", () => {
  it("depot --version returns a semver and exits 0", async () => {
    await e2eScenario(async (ctx) => {
      const result = await ctx.agent.run("depot --version");
      ctx.expect.exitCode(result, 0);
      const trimmed = result.stdout.trim();
      if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/m.test(trimmed)) {
        throw new Error(`expected semver in stdout, got: ${JSON.stringify(trimmed)}`);
      }
    }, "smoke depot --version");
  });
});
