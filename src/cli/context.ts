import { openDatabase, defaultDbPath, type Database } from "#/db/client";
import { resolveWorkspace } from "#/lib/workflow";
import { log } from "#/lib/logger";
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
export async function resolveCurrentWorkspace() {
  const db = await getDb();
  const cwd = process.cwd().replace(/\\/g, "/");
  log.debug("Resolving workspace for", cwd);

  const ws = await resolveWorkspace(db, cwd);
  if (!ws) {
    console.error("No workspace found for current directory. Run `depot init` first.");
    process.exit(1);
  }

  log.debug("Resolved workspace", ws.id, "->", ws.path);
  return { db, ws };
}
