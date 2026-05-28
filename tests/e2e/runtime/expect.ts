import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { existsSync } from "node:fs";
import { logExpectFailure, truncate } from "./log";
import type { RunResult } from "./agent";

/**
 * Scenario-level assertions. Each failure goes through `fail()` so the
 * transcript log gets a uniformly-styled `✗ expect.<kind>` block before
 * the underlying `Error` propagates to vitest. That way a developer
 * reading the test output sees exactly which assertion failed in context,
 * without needing to scroll up to vitest's own diff output.
 */

export type ExpectHelper = {
  contains(haystack: string, needle: string): void;
  notContains(haystack: string, needle: string): void;
  exitCode(result: RunResult, expected: number): void;
  dbHas(table: string, where: Record<string, unknown>): void;
  dbRow<T = Record<string, unknown>>(table: string, where: Record<string, unknown>): T;
};

export type ExpectSetup = {
  scenarioRoot: string;
};

export function createExpectHelper(setup: ExpectSetup): ExpectHelper {
  const dbPath = path.join(setup.scenarioRoot, "depot.db");

  function readDb(): DatabaseSync {
    if (!existsSync(dbPath)) {
      fail("dbHas", [
        `database does not exist yet: ${dbPath}`,
        "(run a depot command first to trigger auto-migration)",
      ]);
    }
    return new DatabaseSync(dbPath, { readOnly: true });
  }

  return {
    contains(haystack, needle) {
      if (!haystack.includes(needle)) {
        fail("contains", [`looking for: ${needle}`, `in: ${truncate(haystack)}`]);
      }
    },

    notContains(haystack, needle) {
      if (haystack.includes(needle)) {
        fail("notContains", [`should not contain: ${needle}`, `but got: ${truncate(haystack)}`]);
      }
    },

    exitCode(result, expected) {
      if (result.exitCode !== expected) {
        fail("exitCode", [
          `expected: ${expected}`,
          `got: ${result.exitCode}`,
          `stderr: ${truncate(result.stderr)}`,
        ]);
      }
    },

    dbHas(table, where) {
      const db = readDb();
      try {
        const { sql, params } = buildSelect(table, where, 1);
        const row = db.prepare(sql).get(...params);
        if (!row) {
          fail("dbHas", [
            `table: ${table}`,
            `where: ${JSON.stringify(where)}`,
            "no matching row found",
          ]);
        }
      } finally {
        db.close();
      }
    },

    dbRow<T = Record<string, unknown>>(table: string, where: Record<string, unknown>): T {
      const db = readDb();
      try {
        const { sql, params } = buildSelect(table, where, 2);
        const rows = db.prepare(sql).all(...params);
        if (rows.length === 0) {
          fail("dbRow", [`table: ${table}`, `where: ${JSON.stringify(where)}`, "no matching row"]);
        }
        if (rows.length > 1) {
          fail("dbRow", [
            `table: ${table}`,
            `where: ${JSON.stringify(where)}`,
            `expected exactly 1 row, got ${rows.length}`,
          ]);
        }
        return rows[0] as T;
      } finally {
        db.close();
      }
    },
  };
}

function buildSelect(
  table: string,
  where: Record<string, unknown>,
  limit: number,
): { sql: string; params: ReadonlyArray<string | number | bigint | null | Uint8Array> } {
  assertSafeIdent(table);
  const clauses: string[] = [];
  const params: Array<string | number | bigint | null | Uint8Array> = [];
  for (const [col, value] of Object.entries(where)) {
    assertSafeIdent(col);
    if (value === null) {
      clauses.push(`${col} IS NULL`);
      continue;
    }
    clauses.push(`${col} = ?`);
    params.push(toBindable(value));
  }
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql: `SELECT * FROM ${table} ${whereSql} LIMIT ${limit}`, params };
}

function toBindable(value: unknown): string | number | bigint | Uint8Array {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return JSON.stringify(value);
}

function assertSafeIdent(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`expect: refusing to interpolate unsafe identifier '${name}'`);
  }
}

function fail(kind: string, lines: ReadonlyArray<string>): never {
  logExpectFailure(kind, lines);
  throw new Error(`expect.${kind} failed: ${lines.join(" | ")}`);
}
