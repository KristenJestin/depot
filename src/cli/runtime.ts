import { openDatabase, defaultDbPath, type Database } from "#/db/client";
import { resolveWorkspace } from "#/lib/workflow";
import { log } from "#/lib/logger";
import { normalizeWorkspacePath } from "#/lib/paths";
import { resolveOrCreateWorkspaceForPath } from "#/lib/workspace-bootstrap";
import { outputError } from "#/cli/output";
import * as path from "path";
import fs from "fs/promises";

let _db: Database | null = null;

/**
 * Get (or lazily open) the global depot database.
 * Creates `~/.depot/` if it does not exist yet.
 */
export async function getDb(): Promise<Database> {
  if (_db) return _db;

  const dbPath = defaultDbPath();
  log.debug("Opening database at", dbPath);

  // `mkdir` with `recursive: true` is a no-op when the directory already exists,
  // so we don't need a separate `existsSync` check.
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const depotDir = path.join(home, ".depot");
  await fs.mkdir(depotDir, { recursive: true });

  const { db } = openDatabase(dbPath);
  _db = db;
  return _db;
}

/**
 * Resolve the workspace matching the current working directory.
 * Exits with code 1 if no workspace is found.
 */
export async function resolveCurrentWorkspace(options: { autoCreate?: boolean; cwd?: string } = {}) {
  const db = await getDb();
  const rawCwd = options.cwd ?? process.cwd();
  const cwd = normalizeWorkspacePath(rawCwd);
  log.debug("Resolving workspace for", cwd);

  let ws = await resolveWorkspace(db, cwd);
  if (!ws && options.autoCreate) {
    ws = (await resolveOrCreateWorkspaceForPath(db, rawCwd)).workspace;
  }

  if (!ws) {
    outputError("no_workspace", "No workspace found for current directory. Run `depot init` first.");
  }

  log.debug("Resolved workspace", ws.id, "->", ws.path);
  return { db, ws };
}
