import { beforeEach } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { openDatabaseWith, type Database } from "#/db/client";
import { workspaces, type WorkspaceRow } from "#/db/schema";
import { Db } from "#/services/database";
import { generateId } from "#/shared/utils";
import { DatabaseSync } from "node:sqlite";

type Runtime = ManagedRuntime.ManagedRuntime<Db, never>;

let db: Database;
let client: DatabaseSync;
let runtime: Runtime;

function createRuntime() {
  const opened = openDatabaseWith(":memory:", {
    databaseFactory: (databasePath) => new DatabaseSync(databasePath),
  });

  client = opened.client;
  db = opened.db;
  runtime = ManagedRuntime.make(Layer.succeed(Db, db));
}

beforeEach(() => {
  client?.close();
  createRuntime();
});

createRuntime();

export function getTestDb(): Database {
  return db;
}

export function runE<A, E>(effect: Effect.Effect<A, E, Db>): Promise<A> {
  return runtime.runPromise(effect);
}

export async function createTestWorkspace(
  projectId: string,
  path = "/tmp/depot-e2e",
): Promise<WorkspaceRow> {
  const rows = await db
    .insert(workspaces)
    .values({
      id: generateId(),
      projectId,
      path,
      label: "test",
    })
    .returning();

  return rows[0]!;
}
