import { Context, Effect, Layer } from "effect";
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
