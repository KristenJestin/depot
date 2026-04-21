import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, openDatabaseWith, resolveMigrationsFolder, type Database } from "#/db/client";

type TestMigrationRunner = (db: Database, config: { migrationsFolder: string }) => void;
type TestDatabaseClient = {
  run: (sql: string) => void;
  close: () => void;
};

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "depot-db-client-"));
  tempDirs.push(dir);
  return dir;
}

function createMigrationLayout(root: string): void {
  const migrationDir = path.join(root, "20260420161744_test_migration");
  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(path.join(migrationDir, "migration.sql"), "CREATE TABLE test (id integer);");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("db client", () => {
  it("resolves migrations from packaged dist/migrations layout", () => {
    const distDir = createTempDir();
    const nestedMigrationsDir = path.join(distDir, "migrations");
    createMigrationLayout(nestedMigrationsDir);

    expect(resolveMigrationsFolder(distDir)).toBe(nestedMigrationsDir);
  });

  it("does not accept legacy dist root migrations layout", () => {
    const distDir = createTempDir();
    createMigrationLayout(distDir);

    expect(() => resolveMigrationsFolder(distDir)).toThrow(/Could not find Drizzle migrations folder/);
  });

  it("retries retryable migration failures once the competing process finishes", () => {
    const distDir = createTempDir();
    createMigrationLayout(path.join(distDir, "migrations"));
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

  it("does not retry non-retryable migration failures", () => {
    const distDir = createTempDir();
    createMigrationLayout(path.join(distDir, "migrations"));
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

  it("retries SQLITE_BUSY during initial PRAGMA setup and closes failed handles", () => {
    const distDir = createTempDir();
    createMigrationLayout(path.join(distDir, "migrations"));
    const clients: TestDatabaseClient[] = [];
    let createCount = 0;
    let closeCount = 0;
    const databaseFactory = () => {
      createCount += 1;
      let runCount = 0;
      const client: TestDatabaseClient = {
        run: () => {
          runCount += 1;
          if (createCount === 1 && runCount === 1) {
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
      createDbFn: () => ({} as Database),
      migrateFn: () => {},
      maxAttempts: 2,
      retryDelayMs: 0,
    });

    expect(createCount).toBe(2);
    expect(closeCount).toBe(1);
    expect(result.client).toBe(clients[1]);
  });

  it("closes the handle when migrations fail after opening the DB", () => {
    const distDir = createTempDir();
    createMigrationLayout(path.join(distDir, "migrations"));
    let closeCount = 0;

    expect(() =>
      openDatabaseWith(":memory:", {
        baseDir: distDir,
        databaseFactory: () => ({
          run: () => {},
          close: () => {
            closeCount += 1;
          },
        }),
        createDbFn: () => ({} as Database),
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
