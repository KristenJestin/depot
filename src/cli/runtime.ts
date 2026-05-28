import { Effect } from "effect";
import { Db, getDb, getRuntime } from "#/services/database";
import { log } from "#/shared/logger";
import { normalizeWorkspacePath } from "#/shared/utils";
import { resolveWorkspace } from "#/modules/workspaces/domain";
import { resolveCurrentRepo } from "#/modules/projects/repos";
import { resolveOrCreateWorkspaceForPath } from "#/modules/workspaces/bootstrap";
import { outputError } from "#/cli/output";
import { buildNoWorkspaceMessage } from "#/cli/no-workspace-help";

/**
 * Run an Effect that requires the Db service using the shared runtime.
 * Use this in CLI commands that call domain functions directly.
 */
export async function runEffect<A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> {
  return getRuntime().runPromise(effect);
}

/**
 * Resolve the workspace matching the current working directory.
 *
 * - By default, exits with code 1 (via `outputError`) when no workspace is
 *   found. This is the right behaviour for top-level command handlers.
 * - When `throwOnMissing: true` is passed, throws an Error instead so callers
 *   that want to degrade gracefully (e.g. `depot context …` best-effort
 *   helpers) can catch and fall back. Without this option the existing
 *   try/catch wrappers in those helpers are dead code in production because
 *   `outputError` calls `process.exit(1)` before the catch block runs.
 */
export async function resolveCurrentWorkspace(
  options: { autoCreate?: boolean; cwd?: string; throwOnMissing?: boolean } = {},
) {
  const rawCwd = options.cwd ?? process.cwd();
  const cwd = normalizeWorkspacePath(rawCwd);
  log.debug("Resolving workspace for", cwd);

  const failMissing = (code: string, message: string): never => {
    if (options.throwOnMissing) {
      throw new Error(`${code}: ${message}`);
    }
    return outputError(code, message);
  };

  const db = await getDb().catch((e: unknown) =>
    failMissing("db_error", e instanceof Error ? e.message : "Failed to initialize database."),
  );

  let ws = await runEffect(resolveWorkspace(cwd)).catch((e: unknown) =>
    failMissing("db_error", e instanceof Error ? e.message : "Failed to query workspaces."),
  );

  if (!ws && options.autoCreate) {
    try {
      ws = (await resolveOrCreateWorkspaceForPath(db, rawCwd)).workspace;
    } catch (e: unknown) {
      failMissing(
        "auto_create_refused",
        e instanceof Error ? e.message : "Failed to auto-create workspace.",
      );
    }
  }

  if (!ws) {
    const message = await buildNoWorkspaceMessage(cwd, db);
    return failMissing("no_workspace", message);
  }

  log.debug("Resolved workspace", ws.id, "->", ws.path);

  const currentRepo = await runEffect(resolveCurrentRepo(ws, rawCwd)).catch(() => null);
  if (currentRepo) {
    log.debug("Resolved current repo", currentRepo.id, "->", currentRepo.name);
  }

  return { db, ws, currentRepo };
}
