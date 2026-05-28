import { afterEach } from "vite-plus/test";
import { createDirHelper, type DirHelper } from "./dir";
import { createGitHelper, type GitHelper } from "./git";
import { createAgentHelper, type AgentHelper } from "./agent";
import { createExpectHelper, type ExpectHelper } from "./expect";
import { logScenarioStart } from "./log";

/**
 * Orchestrator for one E2E scenario. Wires together a fresh tmp dir + DB +
 * agent + assertions, runs the caller's body, and registers a single
 * `afterEach` cleanup so a failing scenario still tears down its tmp world
 * (unless `E2E_KEEP_TMP=1` is set for post-mortem inspection).
 *
 * Each call to `e2eScenario(fn)` registers its own `afterEach`. Vitest fires
 * `afterEach` hooks in registration order, so a scenario inside an `it()`
 * sees cleanup happen after its body completes, even if it threw.
 */

export type ScenarioCtx = {
  readonly root: string;
  readonly dir: DirHelper;
  readonly git: GitHelper;
  readonly agent: AgentHelper;
  readonly expect: ExpectHelper;
};

export type ScenarioBody = (ctx: ScenarioCtx) => Promise<void> | void;

export async function e2eScenario(body: ScenarioBody, scenarioName?: string): Promise<void> {
  const dirHandle = await createDirHelper();
  const dir = dirHandle.helper;
  let cleaned = false;

  // Auxiliary cleanups registered by helpers during the scenario (e.g.
  // background processes spawned via `agent.spawn`). They run FIFO before
  // the tmp dir is removed so spawned children release ports + file
  // descriptors before their cwd disappears under them.
  const auxCleanups: Array<() => Promise<void> | void> = [];
  const registerCleanup = (fn: () => Promise<void> | void): void => {
    auxCleanups.push(fn);
  };

  const cleanup = async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    for (const fn of auxCleanups) {
      try {
        await fn();
      } catch {
        // Swallow auxiliary cleanup errors: a failing scenario should still
        // tear down its tmp dir. Errors surface via the original failure.
      }
    }
    await dirHandle.cleanup();
  };

  afterEach(cleanup);

  try {
    if (scenarioName) {
      logScenarioStart(scenarioName);
    }
    const initialCwd = await dir.create("cwd");
    const git = createGitHelper(dir);
    const agent = await createAgentHelper({
      scenarioRoot: dir.root,
      initialCwd,
      registerCleanup,
    });
    const expectHelper = createExpectHelper({ scenarioRoot: dir.root });

    const ctx: ScenarioCtx = {
      root: dir.root,
      dir,
      git,
      agent,
      expect: expectHelper,
    };

    await body(ctx);
  } catch (err) {
    await cleanup();
    throw err;
  }
}
