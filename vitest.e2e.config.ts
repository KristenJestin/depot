import { defineConfig } from "vite-plus/test/config";
import path from "node:path";

/**
 * Dedicated config for E2E scenarios that drive the built CLI.
 *
 * Kept separate from `vite.config.ts` because:
 * - E2E scenarios shell out to `dist/index.mjs` (the packed binary), so
 *   they need a longer timeout and threads forced to 1 by default to
 *   avoid git-lock and tmp-dir contention on slower fixtures.
 * - We want `bun run test` to stay fast and skip anything matching
 *   `tests/e2e/**\/*.e2e.test.ts`. That exclusion lives in `vite.config.ts`.
 */
const threadsEnv = process.env["E2E_THREADS"];
const threads = threadsEnv ? Math.max(1, Number.parseInt(threadsEnv, 10)) : 1;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: { NO_COLOR: "1" },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    root: path.resolve(import.meta.dirname),
    include: ["tests/e2e/**/*.e2e.test.ts"],
    pool: "threads",
    singleThread: threads === 1,
    minThreads: threads,
    maxThreads: threads,
    reporters: ["default"],
  },
});
