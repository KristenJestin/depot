/**
 * Post-build smoke tests — verify that the published artifact is functional.
 *
 * These tests are intentionally skipped when `dist/index.mjs` does not exist so
 * that the regular `bun run test` workflow is unaffected. Run them after a full
 * build with `bun run test:smoke`, which rebuilds everything first.
 */
import { describe, test, expect } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../../dist");
// Only run when a full build (CLI + web) is present — skip silently otherwise.
const built =
  existsSync(resolve(distDir, "index.mjs")) && existsSync(resolve(distDir, "web/index.html"));

describe.skipIf(!built)("build smoke", () => {
  test("dist/index.mjs is present", () => {
    expect(existsSync(resolve(distDir, "index.mjs"))).toBe(true);
  });

  test("dist/web/index.html is present", () => {
    expect(existsSync(resolve(distDir, "web/index.html"))).toBe(true);
  });

  test("dist/migrations/ is present", () => {
    expect(existsSync(resolve(distDir, "migrations"))).toBe(true);
  });

  test("CLI --help exits 0", () => {
    const result = spawnSync("node", [resolve(distDir, "index.mjs"), "--help"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/depot/i);
  });

  test("CLI serve --help exits 0", () => {
    const result = spawnSync("node", [resolve(distDir, "index.mjs"), "serve", "--help"], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
  });
});
