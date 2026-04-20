import { ulid } from "ulid";
import { openDatabase, resolveMigrationsFolder, type Database } from "#/db/client";
import type { Database as BunDatabase } from "bun:sqlite";

export { ulid };

/**
 * Create an in-memory database for testing.
 * Returns the Drizzle database and the underlying Bun SQLite client.
 */
export function createTestDb(): { db: Database; client: BunDatabase } {
  return openDatabase(":memory:");
}

export { resolveMigrationsFolder };
