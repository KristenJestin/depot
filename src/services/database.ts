import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { openDatabase, defaultDbPath, type Database } from "#/db/client";
import { DatabaseError } from "#/shared/errors";
import { log } from "#/shared/logger";

export class Db extends Context.Tag("depot/Db")<Db, Database>() {}

export const DbLive: Layer.Layer<Db> = Layer.effect(
  Db,
  Effect.sync(() => {
    const dbPath = defaultDbPath();
    log.debug("Opening database at", dbPath);
    try {
      const { db } = openDatabase(dbPath);
      return db;
    } catch (cause) {
      throw new DatabaseError({ cause, path: dbPath, operation: "open" });
    }
  }),
);

let _runtime: ManagedRuntime.ManagedRuntime<Db, never> | null = null;

export function getRuntime(): ManagedRuntime.ManagedRuntime<Db, never> {
  if (!_runtime) _runtime = ManagedRuntime.make(DbLive);
  return _runtime;
}

export async function getDb(): Promise<Database> {
  return getRuntime().runPromise(Db);
}
