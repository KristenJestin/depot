import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "vite-plus/test";
import { e2eScenario } from "../runtime";

/**
 * Covers PRD 0006 (multi-repo projects) + PRD 0008 (currentRepo resolution).
 *
 * Reproduces the "shell directory" layout (à la nyx): a non-git parent
 * folder hosts three independent git sub-repos that are registered as
 * `project_repo` rows. The scenario asserts that `depot context` resolves
 * the right sub-repo from each cwd (including deep sub-folders) and reports
 * "(no current repo)" at the shell root that itself is not a git repo.
 */

type RepoListItem = {
  id: string;
  name: string;
  path: string;
  isPrimary: boolean;
  baseBranch: string;
};

type RepoListPayload = {
  items: ReadonlyArray<RepoListItem>;
};

describe("e2e multi-repo + currentRepo resolution", () => {
  it("resolves currentRepo per sub-repo, returns no current repo at the shell root, and lists repos coherently", async () => {
    await e2eScenario(async (ctx) => {
      const mainDir = await ctx.dir.create("multi-project");

      const repoNames = ["front", "api", "common"] as const;
      for (const name of repoNames) {
        await ctx.git.initRepoIn(mainDir, name);
      }

      await ctx.agent.run("depot init my-project", { cwd: mainDir });

      await ctx.agent.run(
        "depot project repo add --name front --path front --primary --baseBranch main",
        { cwd: mainDir },
      );
      await ctx.agent.run("depot project repo add --name api --path api --baseBranch main", {
        cwd: mainDir,
      });
      await ctx.agent.run("depot project repo add --name common --path common --baseBranch main", {
        cwd: mainDir,
      });

      // Scenario A — currentRepo resolves from each sub-repo cwd.
      for (const name of repoNames) {
        const result = await ctx.agent.run("depot context", {
          cwd: path.join(mainDir, name),
        });
        ctx.expect.exitCode(result, 0);
        ctx.expect.contains(result.stdout, "Repo");
        ctx.expect.contains(result.stdout, `Repo    : ${name}`);
      }

      // Scenario A (cont.) — shell root matches the workspace but no sub-repo.
      const rootResult = await ctx.agent.run("depot context", { cwd: mainDir });
      ctx.expect.exitCode(rootResult, 0);
      ctx.expect.contains(rootResult.stdout, "(no current repo)");

      // Scenario B — resolution from a deep sub-folder of a sub-repo.
      const deepDir = path.join(mainDir, "api", "src", "deep");
      await mkdir(deepDir, { recursive: true });
      const deepResult = await ctx.agent.run("depot context", { cwd: deepDir });
      ctx.expect.exitCode(deepResult, 0);
      ctx.expect.contains(deepResult.stdout, "Repo");
      ctx.expect.contains(deepResult.stdout, "Repo    : api");

      // Scenario C — project repo list --json reports all three with the right primary flag.
      const listed = await ctx.agent.runJson<RepoListPayload>("depot project repo list --json", {
        cwd: mainDir,
      });
      if (listed.items.length !== 3) {
        throw new Error(
          `expected 3 project_repo entries, got ${listed.items.length}: ${JSON.stringify(listed.items)}`,
        );
      }
      const byName = new Map(listed.items.map((r) => [r.name, r] as const));
      for (const name of repoNames) {
        const row = byName.get(name);
        if (!row) {
          throw new Error(`missing project_repo entry for '${name}'`);
        }
      }
      const front = byName.get("front")!;
      const api = byName.get("api")!;
      const common = byName.get("common")!;
      if (front.isPrimary !== true) {
        throw new Error(`expected 'front' to be primary, got isPrimary=${front.isPrimary}`);
      }
      if (api.isPrimary !== false) {
        throw new Error(`expected 'api' to be non-primary, got isPrimary=${api.isPrimary}`);
      }
      if (common.isPrimary !== false) {
        throw new Error(`expected 'common' to be non-primary, got isPrimary=${common.isPrimary}`);
      }
    }, "multi-repo + currentRepo resolution");
  });
});
