import { Effect } from "effect";
import { Db, getDb, getRuntime } from "#/services/database";
import { log } from "#/shared/logger";
import { normalizeWorkspacePath } from "#/shared/utils";
import { resolveWorkspace } from "#/modules/workspaces/domain";
import { resolveCurrentRepo } from "#/modules/projects/repos";
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
    try {
      ws = (await resolveOrCreateWorkspaceForPath(db, rawCwd)).workspace;
    } catch (e: unknown) {
      outputError(
        "auto_create_refused",
        e instanceof Error ? e.message : "Failed to auto-create workspace.",
      );
    }
  }

  if (!ws) {
    outputError(
      "no_workspace",
      "No workspace found for current directory. Run `depot init` to create a new project here, or `depot workspace add --project <id|name>` to attach this folder to an existing project.",
    );
  }

  log.debug("Resolved workspace", ws.id, "->", ws.path);

  const currentRepo = await runEffect(resolveCurrentRepo(ws, rawCwd)).catch(() => null);
  if (currentRepo) {
    log.debug("Resolved current repo", currentRepo.id, "->", currentRepo.name);
  }

  return { db, ws, currentRepo };
}
