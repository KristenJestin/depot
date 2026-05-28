import { describe, it } from "vite-plus/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { e2eScenario, type ScenarioCtx } from "../runtime";

/**
 * Reproduces the nyx-feature layout: a main repo plus a sibling sub-repo
 * whose feature branch lives in a git linked worktree under a "feature-group"
 * directory. The feature-group is the registered depot workspace; the main
 * repo may or may not also be registered.
 *
 * The scenarios prove that `resolveWorkspace` picks the most specific
 * workspace (the feature-group) when commands run from inside the worktreed
 * sub-repo, even when an ancestor main-repo workspace exists. This is the
 * "longest wins" rule guarded by the 2.6 fix (`fae7b1d`).
 *
 * The DSL surface advertised in the original issue ("contains 'feat-x' in
 * `depot context` output") is not testable as written — `depot context` only
 * prints the resolved `project_repo` name in its header, not the workspace
 * label. We verify resolution by capturing the `workspaceId` written by
 * `depot log add note --json`: that field always reflects the workspace the
 * CLI resolved for the cwd, and is the strongest possible assertion.
 */

type World = {
  readonly mainRepo: string;
  readonly subRepo: string;
  readonly featureGroup: string;
  readonly subRepoWorktree: string;
  readonly subRepoNested: string;
  readonly projectId: string;
  readonly featureGroupWsId: string;
};

type LogAddPayload = {
  item: { id: string; workspaceId: string; projectId: string };
};

type InitPayload = {
  project: { id: string; name: string };
  workspace: { id: string; path: string; label: string | null };
};

type WorkspaceAddPayload = {
  project: { id: string };
  workspace: { id: string; path: string; label: string | null };
};

type PrdCreatePayload = { item: { id: string; status: string } };
type PrdReadyPayload = { item: { id: string; status: string } };
type PrdActivatePayload = { item: { id: string; workspaceId: string | null } };

async function buildWorld(ctx: ScenarioCtx): Promise<World> {
  const mainRepo = await ctx.git.initRepo("main-app", { branches: ["develop"] });
  const subRepo = await ctx.git.initRepoIn(mainRepo, "sub-repo", { branches: ["develop"] });
  // Mirror the real nyx layout: the feature-group dir lives at a path
  // strictly LONGER than the main repo path. The "longest wins" tie-break in
  // `resolveWorkspace` is what protects the feature-group from being shadowed
  // by the main repo workspace, so the test fixture has to honour that
  // invariant or scenario C trivially picks the main-repo workspace.
  const featureGroup = await ctx.dir.create("worktrees-feat-x-long");
  const subRepoWorktree = await ctx.git.worktreeAdd(
    subRepo,
    path.join(featureGroup, "sub-repo"),
    "feature/x",
    "develop",
  );
  const subRepoNested = path.join(subRepoWorktree, "src");
  await mkdir(subRepoNested, { recursive: true });

  const initJson = await ctx.agent.runJson<InitPayload>(
    `depot --json init test-project --label feat-x -p ${featureGroup}`,
    { cwd: mainRepo },
  );

  await ctx.agent.run(
    `depot project repo add --name sub-repo --path ${subRepo} --primary --baseBranch develop`,
    { cwd: featureGroup },
  );

  return {
    mainRepo,
    subRepo,
    featureGroup,
    subRepoWorktree,
    subRepoNested,
    projectId: initJson.project.id,
    featureGroupWsId: initJson.workspace.id,
  };
}

async function resolvedWorkspaceIdFromCwd(ctx: ScenarioCtx, cwd: string): Promise<string> {
  const result = await ctx.agent.runJson<LogAddPayload>(
    `depot --json log add note --payload '{"message":"probe"}'`,
    { cwd },
  );
  return result.item.workspaceId;
}

describe("e2e feature-group / worktree resolution", () => {
  it("A — resolves the feature-group workspace from the feature-group root", async () => {
    await e2eScenario(async (ctx) => {
      const world = await buildWorld(ctx);

      const resolved = await resolvedWorkspaceIdFromCwd(ctx, world.featureGroup);
      if (resolved !== world.featureGroupWsId) {
        throw new Error(`expected feat-x workspace ${world.featureGroupWsId}, got ${resolved}`);
      }

      // Sanity: the DB row exists with the expected label, and the main-app
      // workspace was never registered in this scenario.
      ctx.expect.dbRow("workspaces", { id: world.featureGroupWsId, label: "feat-x" });
    }, "feature-group resolution — A (root of feature-group)");
  });

  it("B — resolves the feature-group workspace from a sub-folder of the worktreed sub-repo", async () => {
    await e2eScenario(async (ctx) => {
      const world = await buildWorld(ctx);

      const resolved = await resolvedWorkspaceIdFromCwd(ctx, world.subRepoNested);
      if (resolved !== world.featureGroupWsId) {
        throw new Error(
          `expected feat-x workspace ${world.featureGroupWsId} from sub-repo nested cwd, got ${resolved}`,
        );
      }

      // depot context should also identify the sub-repo via its registered
      // project_repo: the worktree's git common dir points at the main repo,
      // which matches the registered repo path.
      const ctxResult = await ctx.agent.run("depot context", { cwd: world.subRepoNested });
      ctx.expect.exitCode(ctxResult, 0);
      ctx.expect.contains(ctxResult.stdout, "Repo");
      ctx.expect.contains(ctxResult.stdout, "sub-repo");
    }, "feature-group resolution — B (sub-folder of worktreed sub-repo)");
  });

  it("C — feature-group wins over an ancestor main-repo workspace (longest path)", async () => {
    await e2eScenario(async (ctx) => {
      const world = await buildWorld(ctx);

      const mainWsJson = await ctx.agent.runJson<WorkspaceAddPayload>(
        `depot --json workspace add --project test-project --label main-ws -p ${world.mainRepo}`,
        { cwd: world.mainRepo },
      );
      const mainWsId = mainWsJson.workspace.id;
      if (mainWsId === world.featureGroupWsId) {
        throw new Error("setup invariant: main-ws and feat-x must have distinct ids");
      }

      const resolved = await resolvedWorkspaceIdFromCwd(ctx, world.subRepoNested);
      if (resolved !== world.featureGroupWsId) {
        throw new Error(
          `expected feat-x workspace ${world.featureGroupWsId} to win (got ${resolved}, main-ws is ${mainWsId})`,
        );
      }

      ctx.expect.dbHas("workspaces", { id: mainWsId, label: "main-ws" });
      ctx.expect.dbHas("workspaces", { id: world.featureGroupWsId, label: "feat-x" });
    }, "feature-group resolution — C (longest wins with both registered)");
  });

  it("D — `depot log add` runs end-to-end from a deep sub-folder (smoke for fae7b1d)", async () => {
    await e2eScenario(async (ctx) => {
      const world = await buildWorld(ctx);

      const created = await ctx.agent.runJson<PrdCreatePayload>(
        `depot --json prd create --title 'Feature-group smoke' --context why --scope what`,
        { cwd: world.featureGroup },
      );
      const prdId = created.item.id;

      await ctx.agent.runJson<PrdReadyPayload>(`depot --json prd ready ${prdId}`, {
        cwd: world.featureGroup,
      });

      const activated = await ctx.agent.runJson<PrdActivatePayload>(
        `depot --json prd activate ${prdId}`,
        { cwd: world.featureGroup },
      );
      if (activated.item.workspaceId !== world.featureGroupWsId) {
        throw new Error(
          `expected PRD to be activated against feat-x (${world.featureGroupWsId}), got ${activated.item.workspaceId}`,
        );
      }

      const logResult = await ctx.agent.run(
        `depot log add note --prd ${prdId} --payload '{"message":"e2e D"}'`,
        { cwd: world.subRepoNested },
      );
      ctx.expect.exitCode(logResult, 0);

      ctx.expect.dbHas("activity_log", {
        prd_revision_id: prdId,
        workspace_id: world.featureGroupWsId,
        event_type: "note",
      });
    }, "feature-group resolution — D (depot log add from deep sub-folder)");
  });
});
