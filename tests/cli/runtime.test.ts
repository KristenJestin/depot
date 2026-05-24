import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { Effect } from "effect";
import { createTestDb } from "../helpers/db";
import type { Database } from "#/db/client";
import { Db } from "#/services/database";
import { setJsonMode } from "#/shared/logger";

// The runtime helper uses `getDb` (real) and `runEffect` (real Effect runtime).
// We swap in a per-test in-memory database so no real `.depot/depot.db` is touched.
let currentTestDb: Database;

vi.mock("#/services/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/services/database")>();
  return {
    ...actual,
    getDb: vi.fn<() => Promise<Database>>(async () => currentTestDb),
    getRuntime: () => ({
      runPromise: <A, E>(effect: Effect.Effect<A, E, Db>) =>
        Effect.runPromise(Effect.provideService(effect, Db, currentTestDb)),
    }),
  };
});

describe("resolveCurrentWorkspace", () => {
  beforeEach(() => {
    ({ db: currentTestDb } = createTestDb());
    setJsonMode(false);
  });

  afterEach(() => {
    setJsonMode(false);
  });

  it("error message recommends `depot workspace add` when no workspace is registered", async () => {
    const { resolveCurrentWorkspace } = await import("#/cli/runtime");

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const errMessages: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((m) => {
      errMessages.push(String(m));
    });

    try {
      await expect(resolveCurrentWorkspace({ cwd: "/tmp/no-workspace-here" })).rejects.toThrow(
        "process.exit:1",
      );
      const joined = errMessages.join("\n");
      expect(joined).toMatch(/depot workspace add/);
    } finally {
      exit.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("exits with a clean message when auto-create is asked for at the home directory", async () => {
    const { resolveCurrentWorkspace } = await import("#/cli/runtime");

    const home = "/home/test-user";
    const previousHome = process.env.HOME;
    process.env.HOME = home;

    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const errMessages: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((m) => {
      errMessages.push(String(m));
    });

    try {
      await expect(resolveCurrentWorkspace({ autoCreate: true, cwd: home })).rejects.toThrow(
        "process.exit:1",
      );
      const joined = errMessages.join("\n");
      expect(joined).toMatch(/depot init/);
      expect(joined).not.toMatch(/at\s+\S+:\d+/); // no stack trace lines
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      exit.mockRestore();
      errSpy.mockRestore();
    }
  });
});
