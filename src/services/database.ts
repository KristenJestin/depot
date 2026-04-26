import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { openDatabase, defaultDbPath, defaultDepotDir, type Database } from "#/db/client";
import { log } from "#/shared/logger";
import fs from "node:fs/promises";

export class Db extends Context.Tag("depot/Db")<Db, Database>() {}

export const DbLive: Layer.Layer<Db> = Layer.effect(
  Db,
  Effect.gen(function* () {
    const dbPath = defaultDbPath();
    log.debug("Opening database at", dbPath);

    const depotDir = defaultDepotDir();
    yield* Effect.promise(() => fs.mkdir(depotDir, { recursive: true }));

    const { db } = openDatabase(dbPath);
    return db;
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
