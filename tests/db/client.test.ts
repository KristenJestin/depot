import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyMigrations,
  currentDbMode,
  defaultDbPath,
  defaultDepotDir,
  openDatabase,
  openDatabaseWith,
  resolveMigrationsFolder,
  type Database,
} from "#/db/client";

type TestMigrationRunner = (db: Database, config: { migrationsFolder: string }) => void;
type TestDatabaseClient = {
  exec: (sql: string) => void;
  close: () => void;
};

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "depot-db-client-"));
  tempDirs.push(dir);
  return dir;
}

async function createMigrationLayout(root: string): Promise<void> {
  const migrationDir = path.join(root, "20260420161744_test_migration");
  await fs.mkdir(migrationDir, { recursive: true });
  await fs.writeFile(path.join(migrationDir, "migration.sql"), "CREATE TABLE test (id integer);");
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("openDatabase", () => {
  it("creates parent directory when it does not exist", async () => {
    const baseDir = await createTempDir();
    const dbPath = path.join(baseDir, "nested", "dir", "depot.db");
    const { db, client } = openDatabase(dbPath);
    expect(db).toBeTruthy();
    client.close();
  });

  it("works with :memory: without creating any directory", () => {
    const { db, client } = openDatabase(":memory:");
    expect(db).toBeTruthy();
    client.close();
  });
});

describe("db client", () => {
  it("resolves migrations from packaged dist/migrations layout", async () => {
    const distDir = await createTempDir();
    const nestedMigrationsDir = path.join(distDir, "migrations");
    await createMigrationLayout(nestedMigrationsDir);

    expect(resolveMigrationsFolder(distDir)).toBe(nestedMigrationsDir);
  });

  it("does not accept legacy dist root migrations layout", async () => {
    const distDir = await createTempDir();
    await createMigrationLayout(distDir);

    expect(() => resolveMigrationsFolder(distDir)).toThrow(
      /Could not find Drizzle migrations folder/,
    );
  });

  it("retries retryable migration failures once the competing process finishes", async () => {
    const distDir = await createTempDir();
    await createMigrationLayout(path.join(distDir, "migrations"));
    let callCount = 0;
    const migrateFn: TestMigrationRunner = () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("table projects already exists");
      }
    };

    applyMigrations({} as Database, {
      baseDir: distDir,
      migrateFn,
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    expect(callCount).toBe(2);
  });

  it("does not retry non-retryable migration failures", async () => {
    const distDir = await createTempDir();
    await createMigrationLayout(path.join(distDir, "migrations"));
    let callCount = 0;
    const migrateFn: TestMigrationRunner = () => {
      callCount += 1;
      throw new Error("syntax error near unexpected token");
    };

    expect(() =>
      applyMigrations({} as Database, {
        baseDir: distDir,
        migrateFn,
        maxAttempts: 2,
        retryDelayMs: 0,
      }),
    ).toThrow(/syntax error/i);
    expect(callCount).toBe(1);
  });

  it("retries SQLITE_BUSY during initial PRAGMA setup and closes failed handles", async () => {
    const distDir = await createTempDir();
    await createMigrationLayout(path.join(distDir, "migrations"));
    const clients: TestDatabaseClient[] = [];
    let createCount = 0;
    let closeCount = 0;
    const databaseFactory = () => {
      createCount += 1;
      let execCount = 0;
      const client: TestDatabaseClient = {
        exec: () => {
          execCount += 1;
          if (createCount === 1 && execCount === 1) {
            throw new Error("SQLITE_BUSY_RECOVERY: database is locked");
          }
        },
        close: () => {
          closeCount += 1;
        },
      };
      clients.push(client);
      return client;
    };

    const result = openDatabaseWith(":memory:", {
      baseDir: distDir,
      databaseFactory,
      createDbFn: () => ({}) as Database,
      migrateFn: () => {},
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    expect(createCount).toBe(2);
    expect(closeCount).toBe(1);
    expect(result.client).toBe(clients[1]);
  });

  it("aborts the migration fail-loud when cross-entity corruption is seeded", async () => {
    const baseDir = await createTempDir();
    const dbPath = path.join(baseDir, "corrupt.db");
    // First open runs all migrations cleanly, installing the consistency
    // triggers — this represents an already-migrated database.
    const { db, client } = openDatabase(dbPath);

    const raw = (db as unknown as { $client: { exec: (sql: string) => void } }).$client;
    // Simulate a database whose `cross_entity_triggers` migration has not yet
    // run by removing the trigger, then seed a PRD revision that violates the
    // project/workspace invariant the migration is about to enforce.
    raw.exec("DROP TRIGGER IF EXISTS prd_revisions_workspace_consistency_insert;");
    raw.exec("DROP TRIGGER IF EXISTS prd_revisions_workspace_consistency_update;");
    raw.exec(`
      INSERT INTO projects (id, name, status, created_at, updated_at)
        VALUES ('proj-a', 'A', 'active', 0, 0), ('proj-b', 'B', 'active', 0, 0);
      INSERT INTO workspaces (id, project_id, path, created_at, updated_at)
        VALUES ('ws-b', 'proj-b', '/tmp/ws-b', 0, 0);
      INSERT INTO prds (id, project_id, created_at, updated_at)
        VALUES ('prd-a', 'proj-a', 0, 0);
      INSERT INTO prd_revisions
        (id, prd_id, project_id, workspace_id, revision, title, status, audit_cycles, created_at, updated_at)
        VALUES ('rev-corrupt', 'prd-a', 'proj-a', 'ws-b', 1, 'Corrupt PRD', 'in_progress', 0, 0, 0);
    `);
    client.close();

    // Re-opening must run the consistency guard before the (now pending)
    // triggers migration and abort fail-loud.
    expect(() => openDatabase(dbPath)).toThrow(/Migration aborted/);
    expect(() => openDatabase(dbPath)).toThrow(/depot project diagnose/);
    expect(() => openDatabase(dbPath)).toThrow(/rev-corrupt/);
  });

  it("does not abort when no cross-entity corruption exists", async () => {
    const baseDir = await createTempDir();
    const dbPath = path.join(baseDir, "clean.db");
    const { db, client } = openDatabase(dbPath);
    const raw = (db as unknown as { $client: { exec: (sql: string) => void } }).$client;
    raw.exec("DROP TRIGGER IF EXISTS prd_revisions_workspace_consistency_insert;");
    raw.exec("DROP TRIGGER IF EXISTS prd_revisions_workspace_consistency_update;");
    client.close();

    const reopened = openDatabase(dbPath);
    expect(reopened.db).toBeTruthy();
    reopened.client.close();
  });

  it("closes the handle when migrations fail after opening the DB", async () => {
    const distDir = await createTempDir();
    await createMigrationLayout(path.join(distDir, "migrations"));
    let closeCount = 0;

    expect(() =>
      openDatabaseWith(":memory:", {
        baseDir: distDir,
        databaseFactory: () => ({
          exec: () => {},
          close: () => {
            closeCount += 1;
          },
        }),
        createDbFn: () => ({}) as Database,
        migrateFn: () => {
          throw new Error("syntax error near unexpected token");
        },
        maxAttempts: 1,
        retryDelayMs: 0,
      }),
    ).toThrow(/syntax error/i);

    expect(closeCount).toBe(1);
  });
});

describe("currentDbMode", () => {
  const originalDepot = process.env["DEPOT_DB_PATH"];
  const originalLegacy = process.env["DB_PATH"];

  beforeEach(() => {
    delete process.env["DEPOT_DB_PATH"];
    delete process.env["DB_PATH"];
  });

  afterEach(() => {
    if (originalDepot === undefined) {
      delete process.env["DEPOT_DB_PATH"];
    } else {
      process.env["DEPOT_DB_PATH"] = originalDepot;
    }
    if (originalLegacy === undefined) {
      delete process.env["DB_PATH"];
    } else {
      process.env["DB_PATH"] = originalLegacy;
    }
  });

  it("returns prod with the default ~/.depot path when no env var is set", () => {
    const mode = currentDbMode();
    expect(mode.kind).toBe("prod");
    expect(mode.path).toBe(`${defaultDepotDir()}/depot.db`);
  });

  it("classifies DEPOT_DB_PATH containing .depot-dev as dev", () => {
    process.env["DEPOT_DB_PATH"] = ".depot-dev/depot.db";
    expect(currentDbMode()).toEqual({ kind: "dev", path: ".depot-dev/depot.db" });
  });

  it("classifies any other DEPOT_DB_PATH as custom", () => {
    process.env["DEPOT_DB_PATH"] = "/tmp/test.db";
    expect(currentDbMode()).toEqual({ kind: "custom", path: "/tmp/test.db" });
  });

  it("falls back to the legacy DB_PATH when DEPOT_DB_PATH is unset", () => {
    process.env["DB_PATH"] = ".depot-dev/depot.db";
    expect(currentDbMode()).toEqual({ kind: "dev", path: ".depot-dev/depot.db" });
  });

  it("prefers DEPOT_DB_PATH over the legacy DB_PATH when both are set", () => {
    process.env["DEPOT_DB_PATH"] = "/tmp/preferred.db";
    process.env["DB_PATH"] = "/tmp/legacy.db";
    expect(currentDbMode()).toEqual({ kind: "custom", path: "/tmp/preferred.db" });
  });
});

describe("defaultDbPath", () => {
  const originalDepot = process.env["DEPOT_DB_PATH"];
  const originalLegacy = process.env["DB_PATH"];

  beforeEach(() => {
    delete process.env["DEPOT_DB_PATH"];
    delete process.env["DB_PATH"];
  });

  afterEach(() => {
    if (originalDepot === undefined) {
      delete process.env["DEPOT_DB_PATH"];
    } else {
      process.env["DEPOT_DB_PATH"] = originalDepot;
    }
    if (originalLegacy === undefined) {
      delete process.env["DB_PATH"];
    } else {
      process.env["DB_PATH"] = originalLegacy;
    }
  });

  it("returns the production path when no env var is set", () => {
    expect(defaultDbPath()).toBe(`${defaultDepotDir()}/depot.db`);
  });

  it("returns the override when DEPOT_DB_PATH is set", () => {
    process.env["DEPOT_DB_PATH"] = "/tmp/from-env.db";
    expect(defaultDbPath()).toBe("/tmp/from-env.db");
  });
});
