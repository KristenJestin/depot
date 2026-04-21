import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, resolveMigrationsFolder, type Database } from "#/db/client";

type TestMigrationRunner = (db: Database, config: { migrationsFolder: string }) => void;

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
  it("resolves migrations from packaged dist root layout", () => {
    const distDir = createTempDir();
    createMigrationLayout(distDir);

    expect(resolveMigrationsFolder(distDir)).toBe(distDir);
  });

  it("prefers dist/migrations when both packaged layouts exist", () => {
    const distDir = createTempDir();
    createMigrationLayout(distDir);
    const nestedMigrationsDir = path.join(distDir, "migrations");
    createMigrationLayout(nestedMigrationsDir);

    expect(resolveMigrationsFolder(distDir)).toBe(nestedMigrationsDir);
  });

  it("retries retryable migration failures once the competing process finishes", () => {
    const distDir = createTempDir();
    createMigrationLayout(distDir);
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
    createMigrationLayout(distDir);
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
});
