import { Effect } from "effect";
import { Db, getDb, getRuntime } from "#/services/database";
import { log } from "#/shared/logger";
import { normalizeWorkspacePath } from "#/shared/utils";
import { resolveWorkspace } from "#/modules/workspaces/domain";
import { resolveOrCreateWorkspaceForPath } from "#/modules/workspaces/bootstrap";
import { outputError } from "#/cli/output";

/**
 * Run an Effect that requires the Db service using the shared runtime.
 * Use this in CLI commands that call domain functions directly.
 */
export async function runEffect<A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> {
  return getRuntime().runPromise(effect);
}

/**
 * Resolve the workspace matching the current working directory.
 * Exits with code 1 if no workspace is found.
 */
export async function resolveCurrentWorkspace(
  options: { autoCreate?: boolean; cwd?: string } = {},
) {
  const rawCwd = options.cwd ?? process.cwd();
  const cwd = normalizeWorkspacePath(rawCwd);
  log.debug("Resolving workspace for", cwd);

  const db = await getDb().catch((e: unknown) =>
    outputError("db_error", e instanceof Error ? e.message : "Failed to initialize database."),
  );

  let ws = await runEffect(resolveWorkspace(cwd)).catch((e: unknown) =>
    outputError("db_error", e instanceof Error ? e.message : "Failed to query workspaces."),
  );

  if (!ws && options.autoCreate) {
    ws = (await resolveOrCreateWorkspaceForPath(db, rawCwd)).workspace;
  }

  if (!ws) {
    outputError(
      "no_workspace",
      "No workspace found for current directory. Run `depot init` first.",
    );
  }

  log.debug("Resolved workspace", ws.id, "->", ws.path);
  return { db, ws };
}
