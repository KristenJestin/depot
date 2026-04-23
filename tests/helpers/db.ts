import { ulid } from "ulid";
import { Effect, Layer } from "effect";
import { openDatabase, resolveMigrationsFolder, type Database } from "#/db/client";
import { Db } from "#/services/database";
import type { DatabaseSync } from "node:sqlite";

export { ulid };

/**
 * Create an in-memory database for testing.
 * Returns the Drizzle database and the underlying SQLite client.
 */
export function createTestDb(): { db: Database; client: DatabaseSync } {
  return openDatabase(":memory:");
}

/**
 * Create a helper that runs an Effect with a given Database injected as the Db service.
 * Useful for testing domain functions that require the Db context.
 */
export function makeRun(db: Database) {
  const layer = Layer.succeed(Db, db);
  return function run<A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> {
    return Effect.runPromise(Effect.provide(effect, layer));
  };
}

export { resolveMigrationsFolder };
