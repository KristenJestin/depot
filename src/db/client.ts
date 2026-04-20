import { Database as BunDatabase } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "#/db/schema";
import { MIGRATIONS } from "#/db/migrations";

export type Database = ReturnType<typeof createDb>;

// ── Migration runner ──────────────────────────────────────────────────────────

/**
 * Apply any pending migrations to the database.
 * Idempotent: already-applied migrations are skipped via the `_depot_migrations` table.
 */
export function applyMigrations(client: BunDatabase): void {
  // Ensure the tracking table exists before checking migration state
  client.run(`
    CREATE TABLE IF NOT EXISTS _depot_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const checkStmt = client.query("SELECT 1 FROM _depot_migrations WHERE name = ?");
  const recordStmt = client.query(
    "INSERT INTO _depot_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const migration of MIGRATIONS) {
    // Skip migrations that have already been applied
    if (checkStmt.get(migration.name)) continue;

    for (const statement of migration.statements) {
      client.run(statement);
    }

    recordStmt.run(migration.name, new Date().toISOString());
  }
}

// ── Database factory ──────────────────────────────────────────────────────────

function createDb(client: BunDatabase) {
  return drizzle({ client, relations: schema.relations });
}

/**
 * Open (or create) the depot database at the given path.
 * Runs pending migrations automatically.
 * Use `":memory:"` for tests.
 */
export function openDatabase(path: string): { db: Database; client: BunDatabase } {
  const client = new BunDatabase(path);
  client.run("PRAGMA journal_mode = WAL;");
  client.run("PRAGMA foreign_keys = ON;");
  applyMigrations(client);
  const db = createDb(client);
  return { db, client };
}

/**
 * Resolve the default database path: `~/.depot/depot.db`.
 */
export function defaultDbPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return `${home.replace(/\\/g, "/")}/.depot/depot.db`;
}
