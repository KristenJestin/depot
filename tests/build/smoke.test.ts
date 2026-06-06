/**
 * Post-build smoke tests — verify that the published artifact is functional.
 *
 * These tests are intentionally skipped when `dist/index.mjs` does not exist so
 * that the regular `bun run test` workflow is unaffected. Run them after a full
 * build with `bun run test:smoke`, which rebuilds everything first.
 */
import { describe, test, expect } from "vite-plus/test";
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const distDir = resolve(import.meta.dirname, "../../dist");
const CLI_SMOKE_TIMEOUT_MS = 30_000;
const PACK_SMOKE_TIMEOUT_MS = 60_000;
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

  test(
    "CLI --help exits 0",
    () => {
      const result = spawnSync("node", [resolve(distDir, "index.mjs"), "--help"], {
        encoding: "utf-8",
        timeout: CLI_SMOKE_TIMEOUT_MS,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/depot/i);
    },
    CLI_SMOKE_TIMEOUT_MS,
  );

  test(
    "CLI serve --help exits 0",
    () => {
      const result = spawnSync("node", [resolve(distDir, "index.mjs"), "serve", "--help"], {
        encoding: "utf-8",
        timeout: CLI_SMOKE_TIMEOUT_MS,
      });
      expect(result.status).toBe(0);
    },
    CLI_SMOKE_TIMEOUT_MS,
  );

  test(
    "npm pack tarball includes dist/web/index.html and dist/index.mjs",
    () => {
      const projectRoot = resolve(distDir, "..");
      const npmCacheDir = resolve(projectRoot, ".depot-dev/npm-cache");
      mkdirSync(npmCacheDir, { recursive: true });
      const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
        encoding: "utf-8",
        env: { ...process.env, npm_config_cache: npmCacheDir },
        timeout: PACK_SMOKE_TIMEOUT_MS,
        cwd: projectRoot,
      });
      if (result.status !== 0) {
        throw new Error(`npm pack --json failed:\n${result.stdout}\n${result.stderr}`);
      }
      let packs: Array<{ files: Array<{ path: string }> }>;
      try {
        packs = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `npm pack --json produced non-JSON output:\n${result.stdout}\n${result.stderr}`,
        );
      }
      const files = packs[0].files.map((f) => f.path);
      expect(files).toContain("dist/index.mjs");
      expect(files).toContain("dist/web/index.html");
    },
    PACK_SMOKE_TIMEOUT_MS,
  );
});
